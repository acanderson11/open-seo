import { agencyTestSchemaSql } from "./agency-test-schema";

import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import type * as RepoModule from "./ExecutionTaskRepository";
import type * as ServiceModule from "./ExecutionTaskService";
import { draftBoardStage } from "@/types/schemas/executionBoard";
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
let client: Client,
  repo: typeof RepoModule.ExecutionTaskRepository,
  service: typeof ServiceModule;
beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  vi.doMock("@/db", () => ({ db: drizzle(client) }));
  await client.executeMultiple(agencyTestSchemaSql());
  repo = (await import("./ExecutionTaskRepository")).ExecutionTaskRepository;
  service = await import("./ExecutionTaskService");
}, 30_000);
afterAll(() => client.close());
beforeEach(async () => {
  await client.executeMultiple(
    "DELETE FROM execution_tasks; DELETE FROM automation_jobs;",
  );
});
const fields = {
  title: "Fix broken navigation",
  description: "Synthetic fixture",
  category: "technical" as const,
  priority: "critical" as const,
  state: "todo" as const,
};
it("deduplicates creates and rejects a changed request payload", async () => {
  const input = { ...fields, projectId: "p1", requestKey: crypto.randomUUID() };
  const one = await service.createTask("p1", "actor", input),
    two = await service.createTask("p1", "actor", input);
  expect(two.id).toBe(one.id);
  expect(await repo.list("p1")).toHaveLength(1);
  await expect(
    service.createTask("p1", "actor", { ...input, title: "Different task" }),
  ).rejects.toThrow();
  expect(await repo.list("p2")).toHaveLength(0);
});
it("persists a stage move and rejects stale or cross-project edits", async () => {
  const task = await service.createTask("p1", "actor", {
    ...fields,
    projectId: "p1",
    requestKey: crypto.randomUUID(),
  });
  expect(
    await repo.update("p2", task.id, 1, { ...fields, state: "done" }),
  ).toBeNull();
  const changed = await repo.update("p1", task.id, 1, {
    ...fields,
    state: "in_progress",
  });
  expect(changed?.version).toBe(2);
  expect(changed?.state).toBe("in_progress");
  expect(
    await repo.update("p1", task.id, 1, { ...fields, state: "done" }),
  ).toBeNull();
  expect((await repo.list("p1"))[0]?.state).toBe("in_progress");
});
it("changes draft priority without clearing approval, and scopes the mutation", async () => {
  await client.execute(
    "INSERT INTO automation_jobs (id,project_id,request_key,topic,target_url,actor_id,state,context_version,policy_version,version,created_at) VALUES ('j1','p1','r1','Topic','https://example.com','actor','awaiting_approval','ctx','policy',1,'2026-09-26')",
  );
  expect(await repo.prioritizeDraft("p2", "j1", "critical", "normal")).toBe(
    false,
  );
  expect(await repo.prioritizeDraft("p1", "j1", "critical", "normal")).toBe(
    true,
  );
  expect(await repo.prioritizeDraft("p1", "j1", "low", "normal")).toBe(false);
  const row = (
    await client.execute(
      "SELECT state,priority FROM automation_jobs WHERE id='j1'",
    )
  ).rows[0];
  expect(row?.state).toBe("awaiting_approval");
  expect(row?.priority).toBe("critical");
  expect(draftBoardStage(typeof row?.state === "string" ? row.state : "")).toBe(
    "review",
  );
  expect(draftBoardStage("outcome_unknown")).toBe("blocked");
  expect(draftBoardStage("ready_for_manual_publication")).toBe("ready");
});
