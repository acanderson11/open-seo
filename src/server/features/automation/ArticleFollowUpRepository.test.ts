import type * as Module from "./ArticleFollowUpRepository";
import type { Client } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openAgencyTestDb } from "./agency-test-schema";

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
let client: Client;
let repo: typeof Module.ArticleFollowUpRepository;

beforeAll(async () => {
  const test = await openAgencyTestDb();
  client = test.client;
  vi.doMock("@/db", () => ({ db: test.db }));
  repo = (await import("./ArticleFollowUpRepository"))
    .ArticleFollowUpRepository;
});
afterAll(() => client.close());

async function insertPublishedJob(
  id: string,
  projectId: string,
  publishedAt: string | null,
) {
  await client.execute({
    sql: `INSERT INTO automation_jobs
      (id, project_id, request_key, topic, target_url, actor_id, state,
       context_version, policy_version, version, created_at, published_url, published_at)
      VALUES (?, ?, ?, 'Article', 'https://example.com/', 'actor', 'published',
       'context', 'policy', 1, '2026-01-01T00:00:00.000Z', ?, ?)`,
    args: [id, projectId, id, `https://example.com/${id}`, publishedAt],
  });
}

describe("article follow-up scheduling and recovery", () => {
  it("seeds all seven stages once and preserves a legacy monitoring baseline", async () => {
    const first = new Date("2026-10-01T12:00:00.000Z");
    await insertPublishedJob("legacy", "p1", null);
    await repo.seedPublishedJobs(first);
    await repo.seedPublishedJobs(new Date("2026-10-02T12:00:00.000Z"));
    const rows = await repo.list("p1", ["legacy"]);
    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.stage)).toContain("reassess_90");
    expect(
      rows.every(
        (row) =>
          row.scheduleBasis === "monitoring" &&
          row.baselineAt === first.toISOString(),
      ),
    ).toBe(true);
  });

  it("retries only an unavailable row in its own project", async () => {
    await insertPublishedJob("other", "p2", "2026-10-01T12:00:00.000Z");
    await repo.seedPublishedJobs(new Date("2026-10-02T12:00:00.000Z"));
    const [row] = (await repo.list("p2", ["other"])).filter(
      (item) => item.stage === "technical",
    );
    await client.execute({
      sql: "UPDATE article_follow_ups SET state = 'unavailable', attempts = 3 WHERE id = ?",
      args: [row.id],
    });
    const now = "2026-10-04T00:00:00.000Z";
    expect(await repo.retryUnavailable("p1", row.id, now)).toBe(false);
    expect(await repo.retryUnavailable("p2", row.id, now)).toBe(true);
    expect(await repo.retryUnavailable("p2", row.id, now)).toBe(false);
    const [retried] = (await repo.list("p2", ["other"])).filter(
      (item) => item.id === row.id,
    );
    expect(retried).toMatchObject({
      state: "pending",
      dueAt: now,
      baselineAt: row.baselineAt,
    });
  });
});

describe("interrupted follow-up work", () => {
  it("repairs a partial schedule without changing its monitoring baseline", async () => {
    const start = new Date("2026-10-01T12:00:00.000Z");
    await insertPublishedJob("partial", "p1", null);
    await repo.seedPublishedJobs(start);
    await client.execute(
      "DELETE FROM article_follow_ups WHERE job_id = 'partial' AND stage <> 'technical'",
    );
    await repo.seedPublishedJobs(new Date("2026-10-04T12:00:00.000Z"));
    const rows = await repo.list("p1", ["partial"]);
    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.baselineAt === start.toISOString())).toBe(
      true,
    );
    expect(rows.find((row) => row.stage === "indexing_3")?.dueAt).toBe(
      "2026-10-04T12:00:00.000Z",
    );
    expect(await repo.list("p2", ["partial"])).toHaveLength(0);
  });

  it("rejects duplicate claims and a stale worker completing a reclaimed check", async () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    await insertPublishedJob("leased", "p1", start.toISOString());
    await repo.seedPublishedJobs(start);
    const row = (await repo.due(start)).find((item) => item.jobId === "leased");
    expect(row).toBeDefined();
    if (!row) throw new Error("Expected a due publication check");
    const oldLease = "2026-01-01T00:10:00.000Z";
    const newLease = "2026-01-01T00:21:00.000Z";
    expect(await repo.claim(row, oldLease)).toBe(true);
    expect(await repo.claim(row, oldLease)).toBe(false);
    expect(
      (await repo.due(new Date("2026-01-01T00:05:00.000Z"))).some(
        (item) => item.id === row.id,
      ),
    ).toBe(false);
    const expired = (await repo.due(new Date("2026-01-01T00:11:00.000Z"))).find(
      (item) => item.id === row.id,
    );
    if (!expired) throw new Error("Expected expired lease to be recoverable");
    expect(await repo.claim(expired, newLease)).toBe(true);
    await repo.finish(row, oldLease, {
      state: "complete",
      outcome: "healthy",
      detail: "Stale result",
    });
    expect(
      (await repo.list("p1", ["leased"])).find((item) => item.id === row.id)
        ?.state,
    ).toBe("running");
    await repo.finish(expired, newLease, {
      state: "complete",
      outcome: "healthy",
      detail: "Fresh result",
    });
    expect(
      (await repo.list("p1", ["leased"])).find((item) => item.id === row.id),
    ).toMatchObject({ state: "complete", detail: "Fresh result" });
  });
});
