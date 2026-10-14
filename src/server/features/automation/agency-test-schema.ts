import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sort } from "remeda";
import type { runBatch as RunBatch } from "@/db/runBatch";

const FIRST_AGENCY_MIGRATION = 45;

/**
 * SQL for a minimal `projects` table (with rows p1 and p2) followed by every
 * agency migration from 0045 on, in order. Repository tests use this so their
 * schema can't drift behind newly added migrations.
 */
export function agencyTestSchemaSql() {
  const names = readdirSync("drizzle").filter(
    (name) =>
      name.endsWith(".sql") &&
      Number(name.slice(0, 4)) >= FIRST_AGENCY_MIGRATION,
  );
  const migrations = sort(names, (a, b) => a.localeCompare(b)).map((name) =>
    readFileSync(`drizzle/${name}`, "utf8"),
  );
  return (
    "PRAGMA foreign_keys=ON; CREATE TABLE projects(id text PRIMARY KEY); INSERT INTO projects VALUES ('p1'),('p2');" +
    migrations.join("")
  );
}

/**
 * A file-backed libsql database with the agency schema, plus a `runBatch`
 * stand-in that runs statements in one transaction. Callers wire both in with
 * `vi.doMock("@/db", …)` and `vi.doMock("@/db/runBatch", …)` before importing
 * the repository under test.
 */
export async function openAgencyTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "openseo-agency-"));
  // libsql can hold file handles until exit on Windows, so the file lives in
  // the OS temp directory rather than being deleted after the run.
  const client = createClient({
    url: "file:" + join(dir, "test.db").replaceAll("\\", "/"),
  });
  const db = drizzle(client);
  await client.executeMultiple(agencyTestSchemaSql());
  const runBatch = async (build: Parameters<typeof RunBatch>[0]) =>
    db.transaction(async (tx) => {
      type Executor = Parameters<Parameters<typeof RunBatch>[0]>[0];
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test adapter: libsql implements the same statement builders
      const executor = tx as unknown as Executor;
      for (const statement of build(executor)) await statement;
    });
  return { client, db, runBatch };
}

/** An automation job row with only the required columns set. */
export const agencyJob = (id: string, projectId = "p1") => ({
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
