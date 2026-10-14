import { agencyTestSchemaSql } from "./agency-test-schema";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import type * as RepoModule from "./InventoryRepository";
import type { runBatch } from "@/db/runBatch";
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
let client: Client;
let repo: typeof RepoModule.InventoryRepository;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "openseo-inventory-"));
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
  await client.executeMultiple(agencyTestSchemaSql());
  repo = (await import("./InventoryRepository")).InventoryRepository;
});
afterAll(() => client.close());
beforeEach(async () => {
  await client.execute("DELETE FROM site_inventory_pages");
});
const seed = (id: string, projectId = "p1") => ({
  id,
  projectId,
  url: "https://example.com/a/",
  discoveredAt: new Date().toISOString(),
});
it("deduplicates project URLs and isolates reads", async () => {
  await repo.seed(seed("a"));
  await repo.seed(seed("b"));
  await repo.seed(seed("c", "p2"));
  expect(await repo.list("p1")).toHaveLength(1);
  expect((await repo.list("p2"))[0]?.id).toBe("c");
});
it("replaces links with the page snapshot and prevents cross-project writes", async () => {
  await repo.seed(seed("a"));
  await repo.save("p1", "a", { title: "First" }, [
    { targetUrl: "https://example.com/b/", anchor: "B" },
  ]);
  await repo.save("p2", "a", { title: "Wrong" }, [
    { targetUrl: "https://example.com/c/", anchor: "C" },
  ]);
  expect((await repo.list("p1"))[0]?.title).toBe("First");
  expect(await repo.links("p2")).toEqual([]);
  await repo.save("p1", "a", { title: "Updated" }, []);
  expect(await repo.links("p1")).toEqual([]);
});
it("rolls back content and link changes together on failure", async () => {
  await repo.seed(seed("a"));
  await repo.save("p1", "a", { title: "Original" }, [
    { targetUrl: "https://example.com/b/", anchor: "B" },
  ]);
  await client.execute(
    "CREATE TRIGGER fail_links BEFORE INSERT ON site_inventory_links BEGIN SELECT RAISE(ABORT, 'test'); END;",
  );
  try {
    await expect(
      repo.save("p1", "a", { title: "Broken" }, [
        { targetUrl: "https://example.com/c/", anchor: "C" },
      ]),
    ).rejects.toThrow();
    expect((await repo.list("p1"))[0]?.title).toBe("Original");
    expect((await repo.links("p1"))[0]?.targetUrl).toBe(
      "https://example.com/b/",
    );
  } finally {
    await client.execute("DROP TRIGGER fail_links");
  }
});

it("retains prior content and scopes failure diagnostics to the owning project", async () => {
  await repo.seed(seed("a"));
  await repo.save(
    "p1",
    "a",
    {
      content: "Verified original content",
      readState: "read",
      readStatus: 200,
    },
    [],
  );
  await repo.unavailable("p2", "a", "2026-09-27T00:00:00Z", {
    reason: "siteground-challenge",
    status: 202,
  });
  expect((await repo.list("p1"))[0]?.readState).toBe("read");
  await repo.unavailable("p1", "a", "2026-09-27T00:00:00Z", {
    reason: "siteground-challenge",
    status: 202,
  });
  expect((await repo.list("p1"))[0]).toMatchObject({
    content: "Verified original content",
    readState: "unavailable",
    readFailure: "siteground-challenge",
    readStatus: 202,
  });
});
