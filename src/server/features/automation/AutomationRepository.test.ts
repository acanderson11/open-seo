import type { runBatch } from "@/db/runBatch";
import type * as RepoModule from "./AutomationRepository";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
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
      readFileSync("drizzle/0055_article_approval_reopen.sql", "utf8") +
      readFileSync("drizzle/0057_nifty_skin.sql", "utf8") +
      readFileSync("drizzle/0059_pale_gargoyle.sql", "utf8"),
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
describe("durable automation queue", () => {
  it("deduplicates project requests and isolates project reads", async () => {
    expect(await repo.create(job("j1"))).toBe(true);
    expect(await repo.create(job("j2"))).toBe(false);
    expect(await repo.job("p2", "j1")).toBeNull();
    expect(await repo.create(job("j3", "p2"))).toBe(true);
  });
  it("serializes reservations and enforces the monthly allowance", async () => {
    await repo.savePolicy("p1", {
      enabled: true,
      monthlyLimit: 1,
      approval: "agency",
      expectedVersion: null,
    });
    const p = await repo.policy("p1");
    const claims = await Promise.all([
      repo.reserve("p1", "j1", p.version, "2026-09"),
      repo.reserve("p1", "j2", p.version, "2026-09"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const busy = (await repo.policy("p1")).busyJobId!;
    await repo.releaseSlot("p1", "not-the-owner");
    expect((await repo.policy("p1")).busyJobId).toBe(busy);
    await repo.releaseSlot("p1", busy);
    expect(await repo.reserve("p1", "j3", p.version, "2026-09")).toBe(false);
    expect(await repo.reserve("p1", "j3", p.version, "2026-10")).toBe(true);
  });
  it("rejects stale settings and pauses without resetting usage", async () => {
    expect(
      await repo.savePolicy("p1", {
        enabled: true,
        monthlyLimit: 4,
        approval: "agency",
        expectedVersion: null,
      }),
    ).toBe(true);
    const p = await repo.policy("p1");
    await repo.reserve("p1", "j1", p.version, "2026-09");
    await repo.releaseSlot("p1", "j1");
    expect(
      await repo.savePolicy("p1", {
        enabled: false,
        monthlyLimit: 4,
        approval: "agency",
        expectedVersion: p.version,
      }),
    ).toBe(true);
    expect(
      await repo.savePolicy("p1", {
        enabled: true,
        monthlyLimit: 4,
        approval: "none",
        expectedVersion: p.version,
      }),
    ).toBe(false);
    const paused = await repo.policy("p1");
    expect(paused.used).toBe(1);
    expect(await repo.reserve("p1", "j2", paused.version, "2026-09")).toBe(
      false,
    );
  });
  it("keeps the first version-bound agency decision and rejects cross-project approval", async () => {
    await repo.create({ ...job("j1"), state: "awaiting_approval" });
    expect(await repo.approve("p1", "j1", "a1", "changes_requested")).toBe(
      true,
    );
    expect(await repo.approve("p1", "j1", "a2", "approved")).toBe(false);
    await repo.create({ ...job("j4"), requestKey: "request-4" });
    expect(await repo.approve("p2", "j4", "a2", "approved")).toBe(false);
  });
});
it("rolls back the approval if the state transition fails", async () => {
  await repo.create({ ...job("atomic"), state: "awaiting_approval" });
  await client.executeMultiple(
    "CREATE TRIGGER fail_approval_state BEFORE UPDATE ON automation_jobs WHEN NEW.state = 'ready_for_manual_publication' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
  );
  try {
    await expect(
      repo.approve(
        "p1",
        "atomic",
        "actor",
        "approved",
        "ready_for_manual_publication",
      ),
    ).rejects.toThrow();
    expect(
      (
        await client.execute(
          "SELECT COUNT(*) AS count FROM automation_approvals",
        )
      ).rows[0]?.count,
    ).toBe(0);
    expect((await repo.job("p1", "atomic"))?.state).toBe("awaiting_approval");
  } finally {
    await client.execute("DROP TRIGGER fail_approval_state");
  }
});
it("deduplicates daily planner reservations and consumes each run once", async () => {
  const auto = (await import("./AutopilotRepository")).AutopilotRepository;
  const attempts = await Promise.all([
    auto.reserveRun("p1", "2026-09-01"),
    auto.reserveRun("p1", "2026-09-01"),
  ]);
  expect(attempts.filter(Boolean)).toHaveLength(1);
  const run = attempts.find(Boolean)!;
  expect(await auto.claimRun(run.id)).toBe(true);
  expect(await auto.claimRun(run.id)).toBe(false);
  expect(await auto.reserveRun("p2", "2026-09-01")).not.toBeNull();
});
describe("review feedback and learning", () => {
  const feedback = {
    message: "Use direct explanations instead of metaphors.",
    scope: "preference" as const,
    category: "voice" as const,
    instruction: "Use direct explanations. Avoid metaphors.",
  };
  it("archives the reviewed version and activates an explicit preference atomically", async () => {
    await repo.create({
      ...job("learn"),
      state: "awaiting_approval",
      bodyHtml: "<p>Before</p>",
    });
    expect(
      await repo.approve("p1", "learn", "agency", "changes_requested", {
        state: "revision_queued",
        artifactVersion: 1,
        feedback,
      }),
    ).toBe(true);
    const learning = (await import("./ContentLearningRepository"))
      .ContentLearningRepository;
    expect((await learning.active("p1"))[0]?.instruction).toBe(
      feedback.instruction,
    );
    expect(await learning.active("p2")).toEqual([]);
    const history = await learning.history("p1", "learn");
    expect(history.feedback[0]?.artifactVersion).toBe(1);
    expect(history.revisions[0]?.bodyHtml).toBe("<p>Before</p>");
    expect(
      await repo.approve("p1", "learn", "agency", "approved", {
        state: "ready_for_manual_publication",
        artifactVersion: 1,
      }),
    ).toBe(false);
    expect(await learning.claim("p1", "learn", 1)).toBe(true);
    expect(await learning.claim("p1", "learn", 1)).toBe(false);
    expect((await repo.job("p1", "learn"))?.version).toBe(1);
    expect((await repo.job("p1", "learn"))?.qualityPassed).toBe(0);
  });
  it("does not generalize article-only edits and holds overlapping preferences", async () => {
    const learning = (await import("./ContentLearningRepository"))
      .ContentLearningRepository;
    for (const [id, scope] of [
      ["one", "article"],
      ["two", "preference"],
      ["three", "preference"],
      ["four", "fact"],
    ] as const) {
      await repo.create({
        ...job(id),
        requestKey: id,
        state: "awaiting_approval",
      });
      await repo.approve("p1", id, "actor", "changes_requested", {
        state: "revision_queued",
        artifactVersion: 1,
        feedback: { ...feedback, scope },
      });
    }
    const rules = await learning.guidelines("p1");
    expect(rules).toHaveLength(3);
    expect(rules.filter((item) => item.rule.status === "active")).toHaveLength(
      1,
    );
    expect(
      rules.filter((item) => item.rule.status === "proposed"),
    ).toHaveLength(2);
  });
  it("rejects stale versions without saving feedback or learning", async () => {
    await repo.create({
      ...job("stale"),
      version: 2,
      state: "awaiting_approval",
    });
    expect(
      await repo.approve("p1", "stale", "actor", "changes_requested", {
        state: "revision_queued",
        artifactVersion: 1,
        feedback,
      }),
    ).toBe(false);
    const learning = (await import("./ContentLearningRepository"))
      .ContentLearningRepository;
    expect((await learning.history("p1", "stale")).feedback).toEqual([]);
    expect(await learning.active("p1")).toEqual([]);
  });
  it("keeps only one competing decision and preserves reversible guideline provenance", async () => {
    const learning = (await import("./ContentLearningRepository"))
      .ContentLearningRepository;
    await repo.create({ ...job("race"), state: "awaiting_approval" });
    const decisions = [
      await repo.approve("p1", "race", "actor", "changes_requested", {
        state: "revision_queued",
        artifactVersion: 1,
        feedback,
      }),
      await repo.approve("p1", "race", "actor", "approved", {
        state: "ready_for_manual_publication",
        artifactVersion: 1,
      }),
    ];
    expect(decisions.filter(Boolean)).toHaveLength(1);
    expect(
      await repo.approve("p1", "race", "actor", "approved", {
        state: "ready_for_manual_publication",
        artifactVersion: 1,
      }),
    ).toBe(false);
    const rules = await learning.active("p1");
    if (!rules.length) return;
    const rule = rules[0];
    expect(
      await learning.setStatus("p2", rule.id, 1, "disabled", "actor"),
    ).toBe(false);
    expect(
      await learning.setStatus("p1", rule.id, 1, "disabled", "actor"),
    ).toBe(true);
    expect(await learning.setStatus("p1", rule.id, 1, "active", "actor")).toBe(
      false,
    );
    expect(await learning.active("p1")).toEqual([]);
    expect((await learning.guidelines("p1"))[0]?.feedback.message).toBe(
      feedback.message,
    );
    expect(await learning.setStatus("p1", rule.id, 2, "active", "actor")).toBe(
      true,
    );
  });
  it("holds approval while an image is generating and rejects a stale selected-image snapshot", async () => {
    await repo.create({ ...job("image-race"), state: "awaiting_approval" });
    await client.execute({
      sql: "INSERT INTO article_featured_images(id,project_id,job_id,artifact_version,status,source,visual_brief,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      args: [
        "pending",
        "p1",
        "image-race",
        1,
        "generating",
        "generated",
        "brief",
        "actor",
        new Date().toISOString(),
      ],
    });
    expect(
      await repo.approve("p1", "image-race", "actor", "approved", {
        state: "ready_for_manual_publication",
        artifactVersion: 1,
        featuredImageId: null,
      }),
    ).toBe(false);
    await client.execute(
      "UPDATE article_featured_images SET status='failed' WHERE id='pending'",
    );
    await client.execute({
      sql: "INSERT INTO article_featured_images(id,project_id,job_id,artifact_version,status,source,visual_brief,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      args: [
        "selected",
        "p1",
        "image-race",
        1,
        "ready",
        "client",
        "brief",
        "actor",
        new Date().toISOString(),
      ],
    });
    await client.execute(
      "UPDATE automation_jobs SET featured_image_id='selected' WHERE id='image-race'",
    );
    expect(
      await repo.approve("p1", "image-race", "actor", "approved", {
        state: "ready_for_manual_publication",
        artifactVersion: 1,
        featuredImageId: null,
      }),
    ).toBe(false);
    expect(
      await repo.approve("p1", "image-race", "actor", "approved", {
        state: "ready_for_manual_publication",
        artifactVersion: 1,
        featuredImageId: "selected",
      }),
    ).toBe(true);
  });
  it("carries only the selected ready image into a revised version without changing the original", async () => {
    await repo.create({ ...job("revise-image"), state: "revision_queued" });
    const learning = (await import("./ContentLearningRepository"))
      .ContentLearningRepository;
    await client.execute({
      sql: "INSERT INTO article_featured_images(id,project_id,job_id,artifact_version,status,source,r2_key,visual_brief,alt_text,rights_note,cost_usd,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [
        "image-v1",
        "p1",
        "revise-image",
        1,
        "ready",
        "generated",
        "featured-images/p1/revise-image/1/image-v1.webp",
        "brief",
        "Detailed alt text",
        "rights",
        "0.10",
        "actor",
        new Date().toISOString(),
      ],
    });
    await client.execute(
      "UPDATE automation_jobs SET featured_image_id='image-v1' WHERE id='revise-image'",
    );
    expect(await learning.claim("p1", "revise-image", 1)).toBe(true);
    expect(
      await repo.completeRevision("p1", "revise-image", 1, "image-v1", {
        version: 2,
        state: "awaiting_approval",
        title: "Revised title",
        n8nExecutionId: "revision-1",
        qualityPassed: 1,
      }),
    ).toBe(true);
    const revised = await repo.job("p1", "revise-image");
    expect(revised.version).toBe(2);
    expect(revised.featuredImageId).not.toBe("image-v1");
    expect(revised.featuredImageId).toBeTruthy();
    const oldImage = await client.execute(
      "SELECT artifact_version,alt_text,cost_usd FROM article_featured_images WHERE id='image-v1'",
    );
    expect(oldImage.rows[0]).toMatchObject({
      artifact_version: 1,
      alt_text: "Detailed alt text",
      cost_usd: "0.10",
    });
    const nextImage = await client.execute({
      sql: "SELECT project_id,job_id,artifact_version,status,r2_key,alt_text,cost_usd FROM article_featured_images WHERE id=?",
      args: [revised.featuredImageId!],
    });
    expect(nextImage.rows[0]).toMatchObject({
      project_id: "p1",
      job_id: "revise-image",
      artifact_version: 2,
      status: "ready",
      r2_key: "featured-images/p1/revise-image/1/image-v1.webp",
      alt_text: "Detailed alt text",
      cost_usd: null,
    });
    expect(
      await repo.completeRevision("p1", "revise-image", 1, "image-v1", {
        version: 2,
        n8nExecutionId: "revision-1",
      }),
    ).toBe(false);
    expect(
      await repo.failRevision(
        "p1",
        "revise-image",
        1,
        "outcome_unknown",
        "stale failure",
      ),
    ).toBe(false);
    expect((await repo.job("p1", "revise-image")).state).toBe(
      "awaiting_approval",
    );
  });
  it("does not carry a failed, missing, or foreign selected image", async () => {
    const learning = (await import("./ContentLearningRepository"))
      .ContentLearningRepository;
    await repo.create({ ...job("missing-image"), state: "revision_queued" });
    expect(await learning.claim("p1", "missing-image", 1)).toBe(true);
    expect(
      await repo.completeRevision("p1", "missing-image", 1, null, {
        version: 2,
        state: "awaiting_approval",
        n8nExecutionId: "revision-2",
      }),
    ).toBe(true);
    expect((await repo.job("p1", "missing-image")).featuredImageId).toBeNull();
    await repo.create({
      ...job("failed-image"),
      requestKey: "failed-image",
      state: "revision_queued",
    });
    await client.execute({
      sql: "INSERT INTO article_featured_images(id,project_id,job_id,artifact_version,status,source,visual_brief,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      args: [
        "failed-image-id",
        "p1",
        "failed-image",
        1,
        "failed",
        "generated",
        "brief",
        "actor",
        new Date().toISOString(),
      ],
    });
    await client.execute(
      "UPDATE automation_jobs SET featured_image_id='failed-image-id' WHERE id='failed-image'",
    );
    expect(await learning.claim("p1", "failed-image", 1)).toBe(true);
    expect(
      await repo.completeRevision("p1", "failed-image", 1, "failed-image-id", {
        version: 2,
        state: "awaiting_approval",
        n8nExecutionId: "revision-3",
      }),
    ).toBe(true);
    expect((await repo.job("p1", "failed-image")).featuredImageId).toBeNull();
  });
});
it("only claims explicitly authorized WordPress drafts for their own project", async () => {
  const auto = (await import("./AutopilotRepository")).AutopilotRepository;
  await repo.savePolicy("p1", {
    enabled: true,
    autopilot: true,
    monthlyLimit: 4,
    approval: "agency",
    expectedVersion: null,
  });
  const manual = await repo.policy("p1");
  expect(manual.delivery).toBe("manual");
  await repo.create({
    ...job("manual"),
    kind: "new_content",
    state: "ready_for_manual_publication",
    policyVersion: manual.version,
  });
  await repo.create({
    ...job("connected"),
    requestKey: "connected",
    kind: "new_content",
    state: "ready_for_manual_publication",
    policyVersion: manual.version,
    wordpressVersion: "wp1",
  });
  expect(await auto.pendingPublication()).toEqual([]);
  expect(await auto.claimPublication("p1", "connected")).toBe(false);
  await repo.savePolicy("p1", {
    enabled: true,
    autopilot: true,
    delivery: "wordpress",
    monthlyLimit: 4,
    approval: "agency",
    expectedVersion: manual.version,
  });
  const wp = await repo.policy("p1");
  await repo.update("p1", "manual", { policyVersion: wp.version });
  expect(await auto.pendingPublication()).toEqual([]);
  await repo.create({
    ...job("publish"),
    requestKey: "publish",
    kind: "new_content",
    state: "ready_for_manual_publication",
    policyVersion: wp.version,
    wordpressVersion: "wp1",
  });
  expect(await auto.pendingPublication()).toEqual([
    { projectId: "p1", id: "publish" },
  ]);
  expect(await auto.claimPublication("p2", "publish")).toBe(false);
  expect(await auto.claimPublication("p1", "publish")).toBe(true);
  expect(await auto.claimPublication("p1", "publish")).toBe(false);
  expect((await repo.job("p1", "manual"))?.state).toBe(
    "ready_for_manual_publication",
  );
});
it("persists passage-only feedback on the reviewed version, isolates it, and rejects duplicate writes", async () => {
  await repo.create({
    ...job("passages"),
    state: "needs_revision",
    bodyHtml: "<h2>Start</h2><p>Before</p>",
  });
  const input = {
    state: "revision_queued",
    artifactVersion: 1,
    feedback: {
      message: "",
      scope: "article" as const,
      category: "voice" as const,
      instruction: "",
      passages: [
        { blockIndex: 1, quote: "Before", message: "Use a concrete example." },
      ],
    },
  };
  expect(
    await repo.approve("p2", "passages", "actor", "changes_requested", input),
  ).toBe(false);
  expect(
    await repo.approve("p1", "passages", "actor", "changes_requested", input),
  ).toBe(true);
  expect(
    await repo.approve("p1", "passages", "actor", "changes_requested", input),
  ).toBe(false);
  const learning = (await import("./ContentLearningRepository"))
    .ContentLearningRepository;
  const history = await learning.history("p1", "passages");
  expect(history.feedback).toHaveLength(1);
  expect(history.feedback[0]?.passages).toMatchObject(input.feedback.passages);
  expect(history.feedback[0]?.artifactVersion).toBe(1);
  expect(history.revisions[0]?.bodyHtml).toContain("Before");
  expect((await learning.history("p2", "passages")).feedback).toEqual([]);
  expect(await learning.active("p1")).toEqual([]);
  expect((await repo.job("p1", "passages"))?.state).toBe("revision_queued");
});
