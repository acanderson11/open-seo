import { beforeEach, expect, it, vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";

const m = vi.hoisted(() => ({
  prepare: vi.fn(),
  brief: vi.fn(),
  write: vi.fn(),
  review: vi.fn(),
  correct: vi.fn(),
  save: vi.fn(),
  fail: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {
    env = {};
  },
}));
vi.mock("./pgStep", () => ({
  pgStep: (
    _step: unknown,
    _name: string,
    _config: unknown,
    fn: () => unknown,
  ) => fn(),
}));
vi.mock("@/server/features/automation/ArticleGenerationService", () => ({
  prepareGeneration: m.prepare,
  createBrief: m.brief,
  writeArticle: m.write,
  reviewArticle: m.review,
  correctArticle: m.correct,
  saveGeneration: m.save,
  failGeneration: m.fail,
}));
vi.mock("@/server/features/automation/ArticleRevisionService", () => ({
  preparationMessage: (
    _error: unknown,
    fallback = "Revision could not start.",
  ) => fallback,
}));
import { ArticleGenerationWorkflow } from "./ArticleGenerationWorkflow";

const request = { projectId: "p1", jobId: "j1", version: 1 };
// The base class is stubbed and run() reads only the event payload; steps go through the mocked pgStep.
const workflow = new ArticleGenerationWorkflow(
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- stubbed base class ignores both arguments
  {} as ExecutionContext,
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- stubbed base class ignores both arguments
  {} as Env,
);
const run = () =>
  workflow.run(
    { payload: request, timestamp: new Date(), instanceId: "j1-v1" },
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- pgStep is mocked, so the step is never used
    {} as WorkflowStep,
  );

beforeEach(() => {
  m.prepare.mockResolvedValue({ job: { sources: [] }, warning: null });
  m.brief.mockResolvedValue({ title: "Brief" });
  m.write.mockResolvedValue({ title: "First draft" });
  m.correct.mockResolvedValue({ title: "Corrected draft" });
});

it("saves the first draft when its review passes, with no correction", async () => {
  m.review.mockResolvedValue({ pass: true, issues: [] });
  await run();
  expect(m.correct).not.toHaveBeenCalled();
  expect(m.save.mock.lastCall?.[1]).toMatchObject({
    draft: { title: "First draft" },
  });
});

it("corrects a failed review exactly once and saves the corrected draft", async () => {
  m.review
    .mockResolvedValueOnce({ pass: false, issues: [] })
    .mockResolvedValueOnce({ pass: false, issues: [] });
  await run();
  expect(m.correct).toHaveBeenCalledOnce();
  expect(m.review).toHaveBeenCalledTimes(2);
  expect(m.save.mock.lastCall?.[1]).toMatchObject({
    draft: { title: "Corrected draft" },
    review: { pass: false },
  });
});

it("charges a run that fails after a model call and refunds one that fails before", async () => {
  m.write.mockRejectedValue(new Error("model unavailable"));
  await run();
  expect(m.fail.mock.lastCall?.[1]).toMatchObject({ charged: true });

  m.prepare.mockRejectedValue(new Error("site unreadable"));
  await run();
  expect(m.fail.mock.lastCall?.[1]).toMatchObject({ charged: false });
  expect(m.save).not.toHaveBeenCalled();
});
