import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import type * as RepoModule from "./BriefRepository";
import type { runBatch } from "@/db/runBatch";
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
let client: Client;
let repo: typeof RepoModule.BriefRepository;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "openseo-brief-"));
  client = createClient({
    url: "file:" + join(dir, "test.db").replaceAll("\\", "/"),
  });
  const database = drizzle(client);
  vi.doMock("@/db", () => ({ db: database }));
  vi.doMock("@/db/runBatch", () => ({
    runBatch: async (build: Parameters<typeof runBatch>[0]) =>
      database.transaction(async (tx) => {
        type Executor = Parameters<Parameters<typeof runBatch>[0]>[0];
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- libsql test adapter shares the query builder contract
        const executor = tx as unknown as Executor;
        for (const statement of build(executor)) await statement;
      }),
  }));
  await client.executeMultiple(
    "PRAGMA foreign_keys=ON; CREATE TABLE projects(id text PRIMARY KEY); INSERT INTO projects VALUES ('p1'),('p2');" +
      readFileSync("drizzle/0052_seo_briefs.sql", "utf8"),
  );
  repo = (await import("./BriefRepository")).BriefRepository;
});
afterAll(() => client.close());
beforeEach(async () => {
  await client.execute("DELETE FROM seo_brief_items");
  await client.execute("DELETE FROM seo_brief_evidence");
  await client.execute("DELETE FROM seo_briefs");
});
const seed = (id: string, projectId = "p1") => ({
  id,
  projectId,
  requestKey: id,
  actorId: "admin",
  topic: "Website redesign",
  includeSerp: 0,
  slot: "generation",
  state: "running",
  createdAt: new Date().toISOString(),
});
const source = {
  id: "e0",
  briefId: "a",
  kind: "page",
  title: "Page",
  url: null,
  content: "Original source",
  observedAt: new Date().toISOString(),
};
const section = {
  id: "s1",
  briefId: "a",
  kind: "finding",
  position: 0,
  detail: "Finding",
  evidenceId: "e0",
  quote: "Original source",
};
it("isolates projects and deduplicates concurrent requests", async () => {
  expect(await repo.reserve(seed("a"))).not.toBeNull();
  expect(await repo.reserve(seed("a"))).toBeNull();
  expect(await repo.reserve(seed("b"))).toBeNull();
  expect(await repo.reserve(seed("c", "p2"))).not.toBeNull();
  expect(await repo.detail("p2", "a")).toBeNull();
  await repo.finish("p2", "a", { state: "saved" }, [source], [section]);
  expect((await repo.get("p1", "a"))?.state).toBe("running");
});
it("saves evidence atomically and releases the project slot", async () => {
  await repo.reserve(seed("a"));
  await repo.finish("p1", "a", { state: "saved" }, [source], [section]);
  const saved = await repo.detail("p1", "a");
  expect(saved?.sources).toHaveLength(1);
  expect(saved?.sections).toHaveLength(1);
  expect(saved?.slot).toBeNull();
  expect(await repo.reserve(seed("b"))).not.toBeNull();
  await repo.finish("p1", "a", { state: "failed" }, [], []);
  expect((await repo.get("p1", "a"))?.state).toBe("saved");
});
it("rolls back the whole brief for an invalid evidence reference", async () => {
  await repo.reserve(seed("a"));
  await expect(
    repo.finish(
      "p1",
      "a",
      { state: "saved" },
      [source],
      [{ ...section, evidenceId: "missing" }],
    ),
  ).rejects.toThrow();
  const row = await repo.detail("p1", "a");
  expect(row?.state).toBe("running");
  expect(row?.sources).toHaveLength(0);
});
it("expires abandoned generation and refuses its late result", async () => {
  await repo.reserve({
    ...seed("a"),
    createdAt: new Date(Date.now() - 700000).toISOString(),
  });
  expect(await repo.reserve(seed("b"))).not.toBeNull();
  await repo.finish("p1", "a", { state: "saved" }, [source], [section]);
  expect((await repo.detail("p1", "a"))?.sources).toHaveLength(0);
  expect((await repo.get("p1", "a"))?.state).toBe("failed");
});
