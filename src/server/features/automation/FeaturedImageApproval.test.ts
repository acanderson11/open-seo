import type * as RepoModule from "./AutomationRepository";
import type * as RevisionModule from "./ArticleRevisionRepository";
import type { Client } from "@libsql/client";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { agencyJob as job, openAgencyTestDb } from "./agency-test-schema";
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
let client: Client;
let repo: typeof RepoModule.AutomationRepository;
let revisions: typeof RevisionModule.ArticleRevisionRepository;
beforeAll(async () => {
  const test = await openAgencyTestDb();
  client = test.client;
  vi.doMock("@/db", () => ({ db: test.db }));
  vi.doMock("@/db/runBatch", () => ({ runBatch: test.runBatch }));
  repo = (await import("./AutomationRepository")).AutomationRepository;
  revisions = (await import("./ArticleRevisionRepository"))
    .ArticleRevisionRepository;
}, 30_000);
afterAll(() => client.close());
beforeEach(async () => {
  await client.executeMultiple(
    "DELETE FROM article_featured_images; DELETE FROM automation_approvals; DELETE FROM automation_jobs; DELETE FROM automation_policies;",
  );
});
describe("featured images across approval and revision", () => {
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
      await revisions.completeRevision("p1", "revise-image", 1, "image-v1", {
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
      await revisions.completeRevision("p1", "revise-image", 1, "image-v1", {
        version: 2,
        n8nExecutionId: "revision-1",
      }),
    ).toBe(false);
    expect(
      await revisions.failRevision("p1", "revise-image", 1, "stale failure"),
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
      await revisions.completeRevision("p1", "missing-image", 1, null, {
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
      await revisions.completeRevision(
        "p1",
        "failed-image",
        1,
        "failed-image-id",
        {
          version: 2,
          state: "awaiting_approval",
          n8nExecutionId: "revision-3",
        },
      ),
    ).toBe(true);
    expect((await repo.job("p1", "failed-image")).featuredImageId).toBeNull();
  });
});
