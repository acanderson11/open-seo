import { z } from "zod";
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { startGeneration } from "./ArticleGenerationStart";

const mocks = vi.hoisted(() => ({
  repo: {
    byRequest: vi.fn(),
    policy: vi.fn(),
    create: vi.fn(),
    reserve: vi.fn(),
    update: vi.fn(),
    job: vi.fn(),
    releaseSlot: vi.fn(),
  },
  context: vi.fn(),
  render: vi.fn(),
  pages: vi.fn(),
  start: vi.fn<typeof startGeneration>(),
}));
vi.mock("./ArticleGenerationStart", () => ({ startGeneration: mocks.start }));
vi.mock("./ArticleResearchService", () => ({
  researchArticle: vi.fn(async () => []),
  RESEARCH_GUIDANCE: "Research first",
}));
vi.mock("./FeaturedImageService", () => ({
  prepareFeaturedImage: vi.fn(async () => null),
}));
vi.mock("./DraftReviewService", () => ({ requestReview: vi.fn() }));
vi.mock("./ContentLearningRepository", () => ({
  ContentLearningRepository: { active: async () => [] },
}));
vi.mock("./AutomationRepository", () => ({ AutomationRepository: mocks.repo }));
vi.mock(
  "@/server/features/project-context/services/ProjectContextService",
  () => ({
    ProjectContextService: {
      getProjectContext: mocks.context,
      renderProjectContextMarkdown: mocks.render,
    },
  }),
);
vi.mock("@/server/lib/scrape", () => ({ readPages: mocks.pages }));
import {
  buildDraftJob,
  saveDraft,
  startDraft,
  validateTarget,
} from "./AutomationService";

const input = {
  projectId: "p1",
  requestKey: "c240c513-cb4e-405f-8e0a-930f865f5170",
  topic: "Useful topic",
  targetUrl: "https://example.com/page",
};
beforeEach(() => {
  mocks.repo.byRequest.mockResolvedValue(null);
  mocks.repo.policy.mockResolvedValue({
    enabled: 1,
    version: "pv1",
    approval: "agency",
  });
  mocks.repo.create.mockResolvedValue(true);
  mocks.repo.reserve.mockResolvedValue(true);
  mocks.context.mockResolvedValue({
    sections: [{ key: "business_overview", content: "Fixture Studio" }],
  });
  mocks.render.mockReturnValue("Native context fixture");
  mocks.pages.mockResolvedValue({
    pages: [{ url: input.targetUrl, text: "Fictional page evidence" }],
  });
  mocks.repo.job.mockResolvedValue({ id: "job" });
});

describe("starting a draft", () => {
  it("does not start a second run for an existing request", async () => {
    mocks.repo.byRequest.mockResolvedValue({
      id: "saved",
      topic: input.topic,
      targetUrl: input.targetUrl,
    });
    expect(
      await startDraft("p1", "example.com", "actor", input),
    ).toHaveProperty("id", "saved");
    expect(mocks.repo.reserve).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("blocks a different site or credential-bearing target", () => {
    expect(() =>
      validateTarget("https://example.com.evil.test/page", "example.com"),
    ).toThrow();
    expect(() =>
      validateTarget("https://user:pass@example.com/page", "example.com"),
    ).toThrow();
  });
  it("holds the job without starting a run when the monthly reservation fails", async () => {
    mocks.repo.reserve.mockResolvedValue(false);
    await startDraft("p1", "example.com", "actor", input);
    expect(mocks.repo.update.mock.lastCall?.[2]).toMatchObject({
      state: "held",
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });
});

it("builds a saved-brief draft from the brief's own sources without rereading the site", async () => {
  const job = await buildDraftJob({
    projectId: "p1",
    jobId: "job",
    requestKey: input.requestKey,
    topic: input.topic,
    domain: "example.com",
    targetUrl: input.targetUrl,
    planned: {
      rationale: "Saved brief",
      sourceUrls: [input.targetUrl],
      savedBrief: {
        brief: {
          title: "Article",
          angle: "Useful",
          outline: ["Decide"],
          claims: [],
        },
        sources: [
          { id: "e1", url: input.targetUrl, text: "Factual page evidence" },
        ],
        contextVersion: "ctx",
        guidance: "Research gaps remain",
      },
    },
  });
  expect(job.context).toContain("Native context fixture");
  expect(job.context).toContain("Research gaps remain");
  expect(job.sources[0]?.id).toBe("e1");
  expect(mocks.pages).not.toHaveBeenCalled();
});

it("stores escaped article HTML and asks for approval when the review passes", async () => {
  await saveDraft("p1", "job", {
    draft: {
      title: "Title",
      metaDescription: "Description",
      blocks: [
        { type: "h2", text: "Heading" },
        { type: "paragraph", text: "<script>bad()</script>" },
        { type: "paragraph", text: "Useful text" },
      ],
    },
    review: { pass: true, issues: [] },
    executionId: "app:job-v1",
  });
  const saved = z
    .object({ state: z.string(), bodyHtml: z.string() })
    .parse(mocks.repo.update.mock.lastCall?.[2]);
  expect(saved.state).toBe("awaiting_approval");
  expect(saved.bodyHtml).toContain("&lt;script&gt;");
  expect(mocks.repo.releaseSlot).toHaveBeenCalledOnce();
});
