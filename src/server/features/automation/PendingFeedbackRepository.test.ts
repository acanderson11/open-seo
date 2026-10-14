import type { runBatch } from "@/db/runBatch";
import type * as RepoModule from "./AutomationRepository";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
const testDir = mkdtempSync(join(tmpdir(), "openseo-automation-"));
const testFile = join(testDir, "test.db");
let client: Client;
let repo: typeof RepoModule.AutomationRepository;
beforeAll(async () => {
  client = createClient({ url: "file:" + testFile.replaceAll("\\", "/") });
  const testDb = drizzle(client);
  vi.doMock("@/db", () => ({ db: testDb }));
  vi.doMock("@/db/runBatch", () => ({
    runBatch: async (build: Parameters<typeof runBatch>[0]) =>
      testDb.transaction(async (tx) => {
        type Executor = Parameters<Parameters<typeof runBatch>[0]>[0];
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test adapter: libsql implements the same statement builders
        const executor = tx as unknown as Executor;
        for (const statement of build(executor)) await statement;
      }),
  }));
  await client.executeMultiple(
    "PRAGMA foreign_keys=ON; CREATE TABLE projects(id text PRIMARY KEY); INSERT INTO projects VALUES ('p1'),('p2');" +
      readFileSync("drizzle/0045_content_execution.sql", "utf8") +
      readFileSync("drizzle/0046_execution_board.sql", "utf8") +
      readFileSync("drizzle/0047_content_autopilot.sql", "utf8") +
      readFileSync("drizzle/0048_content_learning.sql", "utf8") +
      readFileSync("drizzle/0049_optional_delivery.sql", "utf8") +
      readFileSync("drizzle/0053_article_passage_comments.sql", "utf8") +
      readFileSync("drizzle/0054_feedback_edit_token.sql", "utf8") +
      readFileSync("drizzle/0055_article_approval_reopen.sql", "utf8"),
  );
  repo = (await import("./AutomationRepository")).AutomationRepository;
});
// libsql can retain native file handles until process exit on Windows. The isolated database lives in the OS temporary directory.
afterAll(() => client.close());
beforeEach(async () => {
  await client.executeMultiple(
    "DELETE FROM automation_approvals; DELETE FROM automation_jobs; DELETE FROM automation_policies;",
  );
});
const job = (id: string, projectId = "p1") => ({
  id,
  projectId,
  requestKey: "request-1",
  topic: "Topic",
  targetUrl: "https://example.com/page",
  actorId: "actor",
  state: "queued",
  contextVersion: "ctx1",
  policyVersion: "policy1",
  version: 1,
  createdAt: new Date().toISOString(),
});

it("updates blocked feedback atomically without queuing a revision or losing the existing scope", async () => {
  await repo.create({
    ...job("j1"),
    state: "awaiting_approval",
    bodyHtml: "<p>Original</p>",
  });
  await repo.approve("p1", "j1", "agency", "changes_requested", {
    state: "needs_revision",
    feedback: {
      message: "Original feedback",
      scope: "article",
      category: "voice",
      instruction: "",
    },
  });
  const learning = (await import("./ContentLearningRepository"))
    .ContentLearningRepository;
  const pending = (await import("./PendingFeedbackRepository"))
    .PendingFeedbackRepository;
  const original = (await learning.history("p1", "j1")).feedback[0];
  const update = {
    message: "Original feedback plus audience guidance",
    scope: "article" as const,
    category: "voice" as const,
    instruction: "",
    passages: [
      { blockIndex: 0, quote: "Original", message: "Add audience changes." },
    ],
  };
  expect(
    await pending.save("p2", "j1", 1, original.id, {
      expectedToken: null,
      feedback: update,
    }),
  ).toBe(false);
  expect(
    await pending.save("p1", "j1", 2, original.id, {
      expectedToken: null,
      feedback: update,
    }),
  ).toBe(false);
  expect(
    await pending.save("p1", "j1", 1, original.id, {
      expectedToken: null,
      feedback: update,
    }),
  ).toBe(true);
  expect(
    await pending.save("p1", "j1", 1, original.id, {
      expectedToken: null,
      feedback: {
        ...update,
        message: "Stale overwrite",
        passages: [],
      },
    }),
  ).toBe(false);
  let saved = (await learning.history("p1", "j1")).feedback[0];
  expect(saved.message).toBe(update.message);
  expect(saved.passages).toMatchObject(update.passages);
  expect(saved.editToken).toBeTruthy();
  expect((await repo.job("p1", "j1"))?.state).toBe("needs_revision");
  expect((await repo.job("p1", "j1"))?.version).toBe(1);
  expect(await learning.active("p1")).toEqual([]);
  expect(
    await pending.save("p1", "j1", 1, saved.id, {
      expectedToken: saved.editToken,
      feedback: {
        ...update,
        passages: [],
      },
    }),
  ).toBe(true);
  saved = (await learning.history("p1", "j1")).feedback[0];
  expect(saved.passages).toEqual([]);
  await repo.update("p1", "j1", { state: "revising" });
  expect(
    await pending.save("p1", "j1", 1, saved.id, {
      expectedToken: saved.editToken,
      feedback: {
        ...update,
        message: "Too late",
      },
    }),
  ).toBe(false);
  expect((await learning.history("p1", "j1")).feedback[0].message).toBe(
    update.message,
  );
  await repo.update("p1", "j1", { state: "needs_revision" });
  expect(
    await pending.save("p1", "j1", 1, saved.id, {
      expectedToken: saved.editToken,
      feedback: update,
      queueRevision: true,
    }),
  ).toBe(true);
  expect((await repo.job("p1", "j1"))?.state).toBe("revision_queued");
  await client.execute("ALTER TABLE projects ADD COLUMN archived_at text");
  await repo.savePolicy("p1", {
    enabled: true,
    monthlyLimit: 8,
    approval: "agency",
    expectedVersion: null,
  });
  const queued = await learning.queued();
  expect(queued[0]?.revisionRequest).toBe(
    (await learning.history("p1", "j1")).feedback[0].editToken,
  );
  expect(queued[0]?.revisionRequest).not.toBe(saved.editToken);
  expect((await repo.job("p1", "j1"))?.message).toContain(
    "optional research questions",
  );
  expect(
    await pending.save("p1", "j1", 1, saved.id, {
      expectedToken: saved.editToken,
      feedback: update,
      queueRevision: true,
    }),
  ).toBe(false);
});

it("refunds only the owning unused reservation and only once", async () => {
  await repo.savePolicy("p1", {
    enabled: true,
    monthlyLimit: 8,
    approval: "agency",
    expectedVersion: null,
  });
  const policy = await repo.policy("p1");
  expect(await repo.reserve("p1", "j1", policy!.version, "2026-09")).toBe(true);
  await repo.releaseSlot("p1", "wrong-job", true);
  expect((await repo.policy("p1"))?.used).toBe(1);
  await repo.releaseSlot("p1", "j1", true);
  await repo.releaseSlot("p1", "j1", true);
  expect((await repo.policy("p1"))?.used).toBe(0);
});

it("reopens approval without losing history or consuming an article version, then permits fresh approval", async () => {
  const lifecycle = (await import("./ArticleLifecycleRepository"))
    .ArticleLifecycleRepository;
  await repo.create({
    ...job("reopen"),
    state: "awaiting_approval",
    bodyHtml: "<p>Draft</p>",
  });
  expect(
    await repo.approve("p1", "reopen", "agency", "approved", {
      state: "ready_for_manual_publication",
      artifactVersion: 1,
    }),
  ).toBe(true);
  expect(await lifecycle.reopen("p2", "reopen", 1, "admin")).toBe(false);
  expect(await lifecycle.reopen("p1", "reopen", 2, "admin")).toBe(false);
  expect(await lifecycle.reopen("p1", "reopen", 1, "admin")).toBe(true);
  expect(await lifecycle.reopen("p1", "reopen", 1, "admin")).toBe(false);
  expect((await repo.job("p1", "reopen"))?.version).toBe(1);
  expect(
    await repo.approve("p1", "reopen", "agency", "approved", {
      state: "ready_for_manual_publication",
      artifactVersion: 1,
    }),
  ).toBe(true);
  const history = await client.execute(
    "SELECT revoked_at,revoked_by FROM automation_approvals WHERE job_id='reopen'",
  );
  expect(history.rows).toHaveLength(2);
  expect(history.rows.filter((r) => r.revoked_by === "admin")).toHaveLength(1);
  expect(
    await lifecycle.complete("p1", "reopen", 1, "https://example.com/article"),
  ).toBe(true);
  expect((await repo.job("p1", "reopen"))?.state).toBe("published");
  expect(
    await lifecycle.complete("p1", "reopen", 1, "https://example.com/article"),
  ).toBe(false);
  expect(await lifecycle.reopen("p1", "reopen", 1, "admin")).toBe(false);
});
it("cannot reopen or manually complete an article already being published", async () => {
  const lifecycle = (await import("./ArticleLifecycleRepository"))
    .ArticleLifecycleRepository;
  await repo.create({ ...job("publishing"), state: "publishing" });
  expect(await lifecycle.reopen("p1", "publishing", 1, "admin")).toBe(false);
  expect(
    await lifecycle.complete(
      "p1",
      "publishing",
      1,
      "https://example.com/article",
    ),
  ).toBe(false);
  await repo.update("p1", "publishing", {
    state: "ready_for_manual_publication",
    wordpressVersion: "connection",
  });
  expect(
    await lifecycle.complete(
      "p1",
      "publishing",
      1,
      "https://example.com/article",
    ),
  ).toBe(false);
});
