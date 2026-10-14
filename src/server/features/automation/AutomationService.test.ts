vi.mock("./ArticleResearchService", () => ({
  researchArticle: vi.fn(async () => []),
  RESEARCH_GUIDANCE: "Research first",
}));
vi.mock("./FeaturedImageService", () => ({ prepareFeaturedImage: vi.fn(async () => null) }));
vi.mock("./FeaturedImageRepository", () => ({ FeaturedImageRepository: { image: vi.fn() } }));
import { z } from "zod";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("./ContentLearningRepository", () => ({
  ContentLearningRepository: { active: async () => [] },
}));
const mocks = vi.hoisted(() => ({
  repo: {
    byRequest: vi.fn(),
    policy: vi.fn(),
    create: vi.fn(),
    reserve: vi.fn(),
    update: vi.fn(),
    job: vi.fn(),
    releaseSlot: vi.fn(),
    approve: vi.fn(),
  },
  context: vi.fn(),
  render: vi.fn(),
  pages: vi.fn(),
  env: vi.fn(),
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
vi.mock("@/server/lib/runtime-env", () => ({ getOptionalEnvValue: mocks.env }));
import {
  startDraft,
  validateTarget,
  decideDraft,
  contextSnapshot,
} from "./AutomationService";
const input = {
  projectId: "p1",
  requestKey: "c240c513-cb4e-405f-8e0a-930f865f5170",
  topic: "Useful topic",
  targetUrl: "https://example.com/page",
};
beforeEach(() => {
  vi.resetAllMocks();
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
  mocks.env.mockResolvedValue("synthetic-secret");
  mocks.repo.job.mockResolvedValue({ id: "job" });
});
afterEach(() => vi.unstubAllGlobals());
describe("OpenSEO execution bridge", () => {
  it("does not redispatch an existing request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mocks.repo.byRequest.mockResolvedValue({
      id: "saved",
      topic: input.topic,
      targetUrl: input.targetUrl,
    });
    expect(
      await startDraft("p1", "example.com", "actor", input),
    ).toHaveProperty("id", "saved");
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.repo.reserve).not.toHaveBeenCalled();
  });
  it("blocks a different site or credential-bearing target before any fetch", () => {
    expect(() =>
      validateTarget("https://example.com.evil.test/page", "example.com"),
    ).toThrow();
    expect(() =>
      validateTarget("https://user:pass@example.com/page", "example.com"),
    ).toThrow();
  });
  it("preserves the reservation after an uncertain remote outcome", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetch);
    await startDraft("p1", "example.com", "actor", input);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.repo.releaseSlot).not.toHaveBeenCalled();
    expect(mocks.repo.update).toHaveBeenLastCalledWith(
      "p1",
      expect.any(String),
      expect.objectContaining({ state: "outcome_unknown" }),
    );
  });
  it("persists sanitized content from the native-context job and requires approval", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (typeof init.body !== "string")
          throw new Error("Expected JSON body");
        const job = z
          .record(z.string(), z.unknown())
          .parse(JSON.parse(init.body));
        expect(job.context).toContain("Native context fixture");
        expect(job.context).toContain("Research first");
        expect(job.profile).toBeUndefined();
        return Response.json({
          ...job,
          n8nExecutionId: "fixture",
          publicationPerformed: false,
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
          html: "<script>untrusted HTML</script>",
        });
      }),
    );
    await startDraft("p1", "example.com", "actor", input);
    const saved = z
      .object({ state: z.string(), bodyHtml: z.string() })
      .parse(mocks.repo.update.mock.lastCall?.[2]);
    expect(saved.state).toBe("awaiting_approval");
    expect(saved.bodyHtml).toContain("&lt;script&gt;");
    expect(mocks.repo.releaseSlot).toHaveBeenCalledOnce();
  });
  it("does not let an agency decision satisfy required client approval", async () => {
    mocks.repo.policy.mockResolvedValue({
      enabled: 1,
      version: "pv1",
      approval: "client",
    });
    mocks.repo.job.mockResolvedValue({
      state: "awaiting_approval",
      version: 1,
      policyVersion: "pv1",
      contextVersion: (await contextSnapshot("p1")).version,
      qualityPassed: 1,
      bodyHtml: "<p>Article</p>",
      featuredImageId: null,
    });
    mocks.repo.approve.mockResolvedValue(true);
    await expect(
      decideDraft("p1", "job", "actor", "approved", { version: 1, featuredImageId: null }),
    ).rejects.toThrow("FORBIDDEN");
    expect(mocks.repo.approve).not.toHaveBeenCalled();
    expect(mocks.repo.update).not.toHaveBeenCalled();
  });
});

it("allows drafts with unanswered research questions to reach approval when quality passes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const payload = z
        .record(z.string(), z.unknown())
        .parse(JSON.parse(z.string().parse(init.body)));
      expect(payload.savedBrief).toBeDefined();
      return Response.json({
        ...payload,
        n8nExecutionId: "fixture",
        publicationPerformed: false,
        draft: {
          title: "Article",
          metaDescription: "Description",
          blocks: [
            { type: "h2", text: "Decide" },
            { type: "paragraph", text: "Useful explanation" },
            { type: "paragraph", text: "Practical steps" },
          ],
        },
        review: { pass: true, issues: [] },
      });
    }),
  );
  const context = await contextSnapshot("p1");
  await startDraft("p1", "example.com", "actor", input, {
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
      contextVersion: context.version,
      guidance: "Research gaps remain",
    },
  });
  const saved = z
    .object({
      state: z.string(),
      qualityPassed: z.number(),
      message: z.string().nullable(),
    })
    .parse(mocks.repo.update.mock.lastCall?.[2]);
  expect(saved.state).toBe("awaiting_approval");
  expect(saved.qualityPassed).toBe(1);
  expect(saved.message).toBeNull();
  expect(mocks.pages).not.toHaveBeenCalled();
});
