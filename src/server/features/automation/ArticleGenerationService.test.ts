import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ generate: vi.fn(), model: vi.fn() }));
vi.mock("ai", () => ({
  generateText: m.generate,
  Output: { object: (options: unknown) => options },
}));
vi.mock("@/server/lib/openrouter", () => ({ getContentModel: m.model }));
vi.mock("@/server/lib/chatAgent", () => ({ openRouterCostUsd: () => 0 }));
vi.mock("./AutomationService", () => ({}));
vi.mock("./ArticleRevisionService", () => ({}));
vi.mock("./AutomationRepository", () => ({ AutomationRepository: {} }));
vi.mock("./ArticleGenerationStart", () => ({ generationInstanceId: vi.fn() }));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: {},
}));
import { createBrief, reviewArticle } from "./ArticleGenerationService";

const stage = { projectId: "p1", jobId: "j1", version: 1 };
const job = {
  contextVersion: "ctx",
  policyVersion: "policy",
  context: "Context",
  opportunity: {
    id: "o1",
    kind: "new_content",
    topic: "Topic",
    intent: "Intent",
    rationale: "Why",
    targetUrl: null,
  },
  sources: [
    { id: "page-1", url: "https://example.com/", text: "We audit 127 checks." },
  ],
};
const modelReturns = (output: unknown) =>
  m.generate.mockResolvedValue({ output, usage: {}, providerMetadata: {} });

beforeEach(() => {
  m.model.mockResolvedValue({ modelId: "fixture-model", model: {} });
});

it("rejects a brief whose evidence is not quoted word for word from a source", async () => {
  const claim = { statement: "Audits are thorough", sourceId: "page-1" };
  modelReturns({
    title: "T",
    angle: "A",
    outline: ["O"],
    claims: [{ ...claim, evidence: "We audit up to 127 checks." }],
  });
  await expect(createBrief(stage, job)).rejects.toThrow("not in its sources");

  modelReturns({
    title: "T",
    angle: "A",
    outline: ["O"],
    claims: [{ ...claim, evidence: "We audit 127 checks." }],
  });
  await expect(createBrief(stage, job)).resolves.toMatchObject({ title: "T" });
});

it("fails a review that reports a blocking issue even when the model says pass", async () => {
  modelReturns({
    pass: true,
    issues: [{ severity: "blocking", reason: "Invented statistic" }],
  });
  const review = await reviewArticle(
    stage,
    {
      job,
      brief: { title: "T", angle: "A", outline: ["O"], claims: [] },
      draft: { title: "T", metaDescription: "M", blocks: [] },
    },
    false,
  );
  expect(review.pass).toBe(false);
});

it("refuses to call a model when no content model is configured", async () => {
  m.model.mockResolvedValue(null);
  await expect(createBrief(stage, job)).rejects.toThrow(
    "OPENROUTER_CONTENT_MODEL",
  );
  expect(m.generate).not.toHaveBeenCalled();
});
