vi.mock("./ArticleResearchService", () => ({
  researchArticle: vi.fn(async () => []),
  RESEARCH_GUIDANCE: "Research first",
}));
vi.mock("./FeaturedImageService", () => ({
  prepareFeaturedImage: vi.fn(async () => null),
}));
import { z } from "zod";
vi.mock("./BriefRepository", () => ({
  BriefRepository: {
    detail: () => m.brief(),
  },
}));
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  brief: vi.fn(),
  job: vi.fn(),
  policy: vi.fn(),
  reserve: vi.fn(),
  update: vi.fn(),
  completeRevision: vi.fn(),
  failRevision: vi.fn(),
  release: vi.fn(),
  history: vi.fn(),
  claim: vi.fn(),
  project: vi.fn(),
  pages: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("./AutomationRepository", () => ({
  AutomationRepository: {
    job: m.job,
    policy: m.policy,
    reserve: m.reserve,
    update: m.update,
    completeRevision: m.completeRevision,
    failRevision: m.failRevision,
    releaseSlot: m.release,
  },
}));
vi.mock("./ContentLearningRepository", () => ({
  ContentLearningRepository: { history: m.history, claim: m.claim },
}));
vi.mock("./AutomationService", () => ({
  contextSnapshot: m.snapshot,
  validateTarget: (s: string) => s,
  boundedResult: async (r: Response) => r.json(),
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: { getProjectById: m.project },
}));
vi.mock("@/server/lib/scrape", () => ({ readPages: m.pages }));
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: async () => "fixture",
}));
import { reviseArticle } from "./ArticleRevisionService";
beforeEach(() => {
  vi.resetAllMocks();
  m.brief.mockImplementation(() => ({
    action: "research_first",
    sources: [
      {
        kind: "page",
        url: "https://example.com/",
        content: "Saved factual source",
        observedAt: new Date().toISOString(),
      },
    ],
  }));
  m.job.mockResolvedValue({
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
  });
  m.policy.mockResolvedValue({
    enabled: 1,
    version: "pv1",
    approval: "client",
    autopilot: 1,
  });
  m.project.mockResolvedValue({ domain: "example.com" });
  m.history.mockResolvedValue({
    feedback: [
      {
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
      },
    ],
  });
  m.claim.mockResolvedValue(true);
  m.reserve.mockResolvedValue(true);
  m.completeRevision.mockResolvedValue(true);
  m.pages.mockResolvedValue({
    pages: [{ url: "https://example.com/", text: "Supported facts" }],
  });
  m.snapshot.mockResolvedValue({
    version: "ctx1",
    rendered: "Current client guidance",
  });
});
afterEach(() => vi.unstubAllGlobals());
const result = {
  jobId: "j1",
  projectId: "p1",
  artifactVersion: 2,
  contextVersion: "ctx1",
  policyVersion: "pv1",
  n8nExecutionId: "remote1",
  draft: {
    title: "Revised",
    metaDescription: "Description",
    blocks: [{ type: "paragraph", text: "Clearer example" }],
  },
  review: { pass: true, issues: [] },
};
it("passes the previous draft and scoped feedback, then requires fresh approval", async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const payload = z
      .object({
        context: z.string(),
        revision: z.object({
          version: z.number(),
          previousBodyHtml: z.string(),
          comments: z.array(
            z.object({ scope: z.string(), message: z.string() }),
          ),
        }),
        feedback: z.array(z.unknown()),
      })
      .parse(JSON.parse(z.string().parse(init.body)));
    expect(payload.context).toContain("do not block revision or approval");
    expect(payload.revision.version).toBe(2);
    expect(payload.revision.previousBodyHtml).toContain("Original");
    expect(payload.revision.comments[0].scope).toBe("article");
    expect(payload.revision.comments[0].message).toContain(
      "Passage 1: “Original supported article”",
    );
    expect(payload.revision.comments[0].message).toContain(
      "Requested change: Add a sourced example here.",
    );
    expect(payload.feedback).toEqual([]);
    return Response.json(result);
  });
  vi.stubGlobal("fetch", fetch);
  await reviseArticle("p1", "j1", 1);
  expect(fetch).toHaveBeenCalledOnce();
  expect(m.pages).not.toHaveBeenCalled();
  expect(m.completeRevision).toHaveBeenLastCalledWith(
    "p1",
    "j1",
    1,
    null,
    expect.objectContaining({
      state: "awaiting_approval",
      qualityPassed: 1,
      bodyHtml: "<p>Clearer example</p>",
      version: 2,
    }),
  );
  expect(m.release).toHaveBeenCalledOnce();
});
it("sends only feedback attached to the version being revised", async () => {
  m.job.mockResolvedValue({ ...(await m.job()), version: 2 });
  m.history.mockResolvedValue({
    feedback: [
      {
        artifactVersion: 2,
        message: "Clarify the conclusion",
        passages: [
          {
            blockIndex: 0,
            quote: "Original supported article",
            message: "Explain why this matters.",
          },
        ],
        instruction: "",
        scope: "article",
      },
      {
        artifactVersion: 1,
        message: "Old request that was already addressed",
        passages: [],
        instruction: "",
        scope: "article",
      },
    ],
  });
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body));
    expect(payload.revision.comments).toHaveLength(1);
    expect(payload.revision.comments[0].message).toContain(
      "Clarify the conclusion",
    );
    expect(payload.revision.comments[0].message).not.toContain("Old request");
    return Response.json({ ...result, artifactVersion: 3 });
  });
  vi.stubGlobal("fetch", fetch);
  await reviseArticle("p1", "j1", 2);
  expect(fetch).toHaveBeenCalledOnce();
});
it("keeps feedback on the reviewed version when n8n returns unchanged article", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ...result,
        draft: {
          ...result.draft,
          blocks: [{ type: "paragraph", text: "Original supported article" }],
        },
      }),
    ),
  );
  await reviseArticle("p1", "j1", 1);
  expect(m.update).toHaveBeenLastCalledWith(
    "p1",
    "j1",
    expect.objectContaining({
      state: "needs_revision",
      qualityPassed: 0,
      message: expect.stringContaining("same article"),
    }),
  );
  expect(m.update.mock.calls.some(([, , value]) => value.version === 2)).toBe(
    false,
  );
  expect(m.release).toHaveBeenCalledOnce();
});
it("explains unreadable source pages and leaves the feedback ready to edit", async () => {
  m.brief.mockResolvedValue(null);
  m.pages.mockResolvedValue({ pages: [], blocked: true });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await reviseArticle("p1", "j1", 1);
  expect(fetch).not.toHaveBeenCalled();
  expect(m.failRevision).toHaveBeenLastCalledWith(
    "p1",
    "j1",
    1,
    "needs_revision",
    expect.stringContaining("source page could not be read"),
  );
  expect(m.release).toHaveBeenCalledWith("p1", "j1", true);
});
it("keeps a historical source warning visible on a successful revision", async () => {
  m.brief.mockResolvedValue({
    sources: [
      {
        kind: "page",
        url: "https://example.com/",
        content: "Previously captured site details",
        observedAt: "2025-01-01T12:00:00.000Z",
      },
    ],
  });
  m.pages.mockResolvedValue({ pages: [], blocked: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      expect(payload.sources[0].text).toContain(
        "Historical site page captured 2025-01-01",
      );
      expect(payload.context).toContain("Historical site snapshots");
      return Response.json(result);
    }),
  );
  await reviseArticle("p1", "j1", 1);
  expect(m.completeRevision).toHaveBeenLastCalledWith(
    "p1",
    "j1",
    1,
    null,
    expect.objectContaining({
      state: "awaiting_approval",
      review: expect.stringContaining(
        "warning: Live site pages could not be read",
      ),
      message: expect.stringContaining("historical site evidence"),
    }),
  );
});
it("does not dispatch a duplicate claim or a fourth revision", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  m.claim.mockResolvedValue(false);
  await reviseArticle("p1", "j1", 1);
  m.job.mockResolvedValue({ ...(await m.job()), version: 4 });
  await reviseArticle("p1", "j1", 4);
  expect(fetch).not.toHaveBeenCalled();
  expect(m.reserve).not.toHaveBeenCalled();
});
it("retains the reservation on unknown or wrong-version results", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ...result, artifactVersion: 1 })),
  );
  await reviseArticle("p1", "j1", 1);
  expect(m.failRevision).toHaveBeenLastCalledWith(
    "p1",
    "j1",
    1,
    "outcome_unknown",
    expect.stringContaining("outcome could not be verified"),
  );
  expect(m.release).not.toHaveBeenCalled();
});
it("holds a failed quality review without another automatic loop", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ...result,
        review: {
          pass: false,
          issues: [{ severity: "blocking", reason: "Missing evidence" }],
        },
      }),
    ),
  );
  await reviseArticle("p1", "j1", 1);
  expect(m.completeRevision).toHaveBeenLastCalledWith(
    "p1",
    "j1",
    1,
    null,
    expect.objectContaining({ state: "needs_revision", qualityPassed: 0 }),
  );
  expect(m.release).toHaveBeenCalledOnce();
});
it("does not call n8n when the monthly reservation fails", async () => {
  m.reserve.mockResolvedValue(false);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await reviseArticle("p1", "j1", 1);
  expect(fetch).not.toHaveBeenCalled();
  expect(m.failRevision).toHaveBeenLastCalledWith(
    "p1",
    "j1",
    1,
    "needs_revision",
    expect.any(String),
  );
});
