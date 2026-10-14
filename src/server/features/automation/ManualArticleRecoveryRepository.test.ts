import type { runBatch } from "@/db/runBatch";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
const testDir = mkdtempSync(join(tmpdir(), "openseo-recovery-"));
const testFile = join(testDir, "test.db");
let client: Client;
let recover: typeof import("./ManualArticleRecoveryRepository").recoverManualArticle;

beforeAll(async () => {
  client = createClient({ url: "file:" + testFile.replaceAll("\\", "/") });
  const testDb = drizzle(client);
  vi.doMock("@/db", () => ({ db: testDb }));
  vi.doMock("@/db/runBatch", () => ({
    runBatch: async (build: Parameters<typeof runBatch>[0]) =>
      testDb.transaction(async (tx) => {
        type Executor = Parameters<Parameters<typeof runBatch>[0]>[0];
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test adapter mirrors D1 statements
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
  recover = (await import("./ManualArticleRecoveryRepository"))
    .recoverManualArticle;
});
afterAll(() => client.close());
beforeEach(async () => {
  await client.executeMultiple(
    "DELETE FROM article_revisions; DELETE FROM article_feedback; DELETE FROM automation_approvals; DELETE FROM automation_jobs; DELETE FROM automation_policies;",
  );
});

const input = {
  projectId: "p1",
  jobId: "j1",
  version: 1,
  actorId: "agency",
  contextVersion: "ctx1",
  policyVersion: "policy1",
  priorExecutionId: "24501",
  title: "A corrected article",
  metaDescription: "A corrected description for the article.",
  bodyHtml: "<h2>Corrected</h2><p>New body.</p><p>More.</p>",
};

async function seed({
  feedback = true,
  busy = "j1",
}: { feedback?: boolean; busy?: string } = {}) {
  await client.execute({
    sql: "INSERT INTO automation_policies(project_id,version,enabled,monthly_limit,approval,period,used,busy_job_id) VALUES ('p1','policy1',1,4,'agency','2026-09',2,?)",
    args: [busy],
  });
  await client.execute(
    "INSERT INTO automation_jobs(id,project_id,request_key,topic,target_url,actor_id,state,context_version,policy_version,version,created_at,title,body_html) VALUES ('j1','p1','request','Topic','https://example.com','agency','outcome_unknown','ctx1','policy1',1,'2026-09-27','Original','<p>Original body</p>')",
  );
  await client.execute(
    "INSERT INTO article_revisions(id,project_id,job_id,artifact_version,title,body_html,context_version,policy_version,created_at) VALUES ('r1','p1','j1',1,'Original','<p>Original body</p>','ctx1','policy1','2026-09-27')",
  );
  if (feedback) {
    await client.execute(
      "INSERT INTO automation_approvals(id,project_id,job_id,artifact_version,role,actor_id,decision,created_at) VALUES ('a1','p1','j1',1,'agency','agency','changes_requested','2026-09-27')",
    );
    await client.execute(
      "INSERT INTO article_feedback(id,project_id,job_id,artifact_version,message,scope,category,actor_id,role,created_at) VALUES ('a1','p1','j1',1,'Improve the article','article','voice','agency','agency','2026-09-27')",
    );
  }
}

it("imports a manual version, preserves original and feedback, and releases only its slot without refund", async () => {
  await seed();
  expect(await recover(input)).toBe(true);
  const job = await client.execute(
    "SELECT state,version,quality_passed,review,n8n_execution_id FROM automation_jobs WHERE id='j1'",
  );
  expect(job.rows[0].state).toBe("awaiting_approval");
  expect(job.rows[0].version).toBe(2);
  expect(job.rows[0].quality_passed).toBe(1);
  expect(String(job.rows[0].review)).toContain(
    "not an automated quality review",
  );
  expect(String(job.rows[0].review)).toContain("previous n8n execution 24501");
  expect(job.rows[0].n8n_execution_id).toBeNull();
  const versions = await client.execute(
    "SELECT artifact_version,body_html FROM article_revisions WHERE job_id='j1' ORDER BY artifact_version",
  );
  expect(versions.rows.map((row) => row.artifact_version)).toEqual([1, 2]);
  expect(versions.rows[0].body_html).toBe("<p>Original body</p>");
  expect(
    (
      await client.execute(
        "SELECT count(*) AS n FROM article_feedback WHERE job_id='j1'",
      )
    ).rows[0].n,
  ).toBe(1);
  const policy = await client.execute(
    "SELECT used,busy_job_id FROM automation_policies WHERE project_id='p1'",
  );
  expect(policy.rows[0].used).toBe(2);
  expect(policy.rows[0].busy_job_id).toBeNull();
  expect(await recover(input)).toBe(false);
});

it("refuses recovery without saved feedback or when another job owns the slot", async () => {
  await seed({ feedback: false });
  expect(await recover(input)).toBe(false);
  await client.execute(
    "UPDATE automation_policies SET busy_job_id='other-job' WHERE project_id='p1'",
  );
  expect(await recover(input)).toBe(false);
  expect(
    (await client.execute("SELECT state FROM automation_jobs WHERE id='j1'"))
      .rows[0].state,
  ).toBe("outcome_unknown");
});

it("refuses stale versions, other projects, and mismatched context", async () => {
  await seed();
  expect(await recover({ ...input, version: 2 })).toBe(false);
  expect(await recover({ ...input, projectId: "p2" })).toBe(false);
  expect(await recover({ ...input, contextVersion: "changed" })).toBe(false);
  expect(
    (
      await client.execute(
        "SELECT busy_job_id FROM automation_policies WHERE project_id='p1'",
      )
    ).rows[0].busy_job_id,
  ).toBe("j1");
});
