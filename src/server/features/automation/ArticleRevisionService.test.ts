import { beforeEach, expect, it, vi } from "vitest";
import type { AutomationRepository } from "./AutomationRepository";
import type { ArticleRevisionRepository } from "./ArticleRevisionRepository";
import type { startGeneration } from "./ArticleGenerationStart";

const m = vi.hoisted(() => ({
  brief: vi.fn<() => unknown>(),
  job: vi.fn(),
  policy: vi.fn(),
  reserve: vi.fn(),
  update: vi.fn<typeof AutomationRepository.update>(),
  completeRevision: vi.fn<typeof ArticleRevisionRepository.completeRevision>(),
  failRevision: vi.fn<typeof ArticleRevisionRepository.failRevision>(),
  release: vi.fn(),
  history: vi.fn(),
  claim: vi.fn(),
  project: vi.fn(),
  pages: vi.fn(),
  snapshot: vi.fn(),
  start: vi.fn<typeof startGeneration>(),
}));
vi.mock("./ArticleGenerationStart", () => ({ startGeneration: m.start }));
vi.mock("./ArticleResearchService", () => ({
  researchArticle: vi.fn(async () => []),
  RESEARCH_GUIDANCE: "Research first",
}));
vi.mock("./FeaturedImageService", () => ({
  prepareFeaturedImage: vi.fn(async () => null),
}));
vi.mock("./DraftReviewService", () => ({ requestReview: vi.fn() }));
vi.mock("./BriefRepository", () => ({
  BriefRepository: { detail: () => m.brief() },
}));
vi.mock("./AutomationRepository", () => ({
  AutomationRepository: {
    job: m.job,
    policy: m.policy,
    reserve: m.reserve,
    update: m.update,
    releaseSlot: m.release,
  },
}));
vi.mock("./ArticleRevisionRepository", () => ({
  ArticleRevisionRepository: {
    completeRevision: m.completeRevision,
    failRevision: m.failRevision,
  },
}));
vi.mock("./ContentLearningRepository", () => ({
  ContentLearningRepository: { history: m.history, claim: m.claim },
}));
vi.mock("./AutomationService", () => ({
  contextSnapshot: m.snapshot,
  validateTarget: (s: string) => s,
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: { getProjectById: m.project },
}));
vi.mock("@/server/lib/scrape", () => ({ readPages: m.pages }));
import {
  buildRevisionJob,
  preparationMessage,
  reviseArticle,
  saveRevision,
} from "./ArticleRevisionService";
import { renderArticle } from "@/types/schemas/automation";

const job = {
  id: "j1",
  projectId: "p1",
  version: 1,
  state: "revision_queued",
  bodyHtml: "<p>Original supported article</p>",
  title: "Original",
  topic: "Original",
  targetUrl: "https://example.com/",
  kind: "new_content",
  requestKey: "r1",
  featuredImageId: null,
};
type Job = Parameters<typeof saveRevision>[0];
type Policy = Parameters<typeof buildRevisionJob>[1];
type Feedback = Parameters<typeof buildRevisionJob>[3][number];
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- only the fields the revision reads are set
const revising = { ...job, state: "revising" } as unknown as Job;
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- only the fields the revision reads are set
const policy = { enabled: 1, version: "pv1" } as unknown as Policy;
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- only the fields the revision reads are set
const feedback = {
  artifactVersion: 1,
  message: "Make the example clearer",
  passages: [
    {
      blockIndex: 0,
      quote: "Original supported article",
      message: "Add a sourced example here.",
    },
  ],
  instruction: "",
  scope: "article",
} as unknown as Feedback;
const draft = {
  title: "Revised",
  metaDescription: "Description",
  blocks: [
    { type: "h2" as const, text: "Example" },
    { type: "paragraph" as const, text: "Clearer example" },
    { type: "paragraph" as const, text: "Why it matters" },
  ],
};
const passing = { pass: true, issues: [] };
const savedPage = (observedAt: string) => ({
  sources: [
    {
      kind: "page",
      url: "https://example.com/",
      content: "Saved factual source",
      observedAt,
    },
  ],
});

beforeEach(() => {
  m.job.mockResolvedValue(job);
  m.policy.mockResolvedValue({ ...policy, busyJobId: null });
  m.project.mockResolvedValue({ domain: "example.com" });
  m.history.mockResolvedValue({ feedback: [feedback] });
  m.claim.mockResolvedValue(true);
  m.reserve.mockResolvedValue(true);
  m.completeRevision.mockResolvedValue(true);
  m.brief.mockReturnValue(savedPage(new Date().toISOString()));
  m.pages.mockResolvedValue({ pages: [] });
  m.snapshot.mockResolvedValue({ version: "ctx1", rendered: "Guidance" });
});

it("gives the model the previous draft and the reviewer's passage comments", async () => {
  const { job: input } = await buildRevisionJob(
    revising,
    policy,
    "example.com",
    [feedback],
  );
  expect(input.revision?.version).toBe(2);
  expect(input.revision?.previousBodyHtml).toContain("Original");
  expect(input.revision?.comments[0]?.message).toContain(
    "Passage 1: “Original supported article”",
  );
  expect(input.context).toContain("do not block revision or approval");
});

it("falls back to dated saved pages, and says so, when the live site can't be read", async () => {
  m.brief.mockReturnValue(savedPage("2025-01-01T12:00:00.000Z"));
  const { job: input, warning } = await buildRevisionJob(
    revising,
    policy,
    "example.com",
    [feedback],
  );
  expect(input.sources[0]?.text).toContain(
    "Historical site page captured 2025-01-01",
  );
  expect(input.context).toContain("Historical site snapshots");
  expect(warning).toContain("Live site pages could not be read");
});

it("explains when no source page is available at all", async () => {
  m.brief.mockReturnValue(null);
  const error = await buildRevisionJob(revising, policy, "example.com", [
    feedback,
  ]).catch((caught: unknown) => caught);
  expect(preparationMessage(error)).toContain("source page could not be read");
});

it("keeps feedback on the reviewed version when the revision is unchanged", async () => {
  await saveRevision(
    { ...revising, bodyHtml: renderArticle(draft) },
    { draft, review: passing, executionId: "app:j1-v2" },
    null,
  );
  expect(m.update.mock.lastCall?.[2]).toMatchObject({
    state: "needs_revision",
    qualityPassed: 0,
  });
  expect(m.completeRevision).not.toHaveBeenCalled();
  expect(m.release).toHaveBeenCalledOnce();
});

it("saves a new version for approval, or holds it when the review fails", async () => {
  await saveRevision(
    revising,
    { draft, review: passing, executionId: "app:j1-v2" },
    null,
  );
  expect(m.completeRevision.mock.lastCall?.[4]).toMatchObject({
    state: "awaiting_approval",
    version: 2,
    qualityPassed: 1,
  });

  await saveRevision(
    revising,
    {
      draft,
      review: {
        pass: true,
        issues: [{ severity: "blocking", reason: "Missing evidence" }],
      },
      executionId: "app:j1-v2",
    },
    null,
  );
  expect(m.completeRevision.mock.lastCall?.[4]).toMatchObject({
    state: "needs_revision",
    qualityPassed: 0,
  });
});

it("starts one generation run for the next version after claiming and reserving", async () => {
  await reviseArticle("p1", "j1", 1);
  expect(m.start).toHaveBeenCalledWith({
    projectId: "p1",
    jobId: "j1",
    version: 2,
  });
});

it("starts nothing for a lost claim or a fourth revision, and refunds a failed reservation", async () => {
  m.claim.mockResolvedValue(false);
  await reviseArticle("p1", "j1", 1);
  m.claim.mockResolvedValue(true);
  m.job.mockResolvedValue({ ...job, version: 4 });
  await reviseArticle("p1", "j1", 4);
  expect(m.start).not.toHaveBeenCalled();
  expect(m.reserve).not.toHaveBeenCalled();

  m.job.mockResolvedValue(job);
  m.reserve.mockResolvedValue(false);
  await reviseArticle("p1", "j1", 1);
  expect(m.start).not.toHaveBeenCalled();
  expect(m.release).toHaveBeenCalledWith("p1", "j1", true);
});
