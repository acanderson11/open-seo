import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  release: vi.fn(),
  failRevision: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({
  env: { ARTICLE_GENERATION_WORKFLOW: { create: m.create, get: m.get } },
}));
vi.mock("@/server/lib/runtime-env", () => ({ getOptionalEnvValue: vi.fn() }));
vi.mock("./AutomationRepository", () => ({
  AutomationRepository: { update: m.update, releaseSlot: m.release },
}));
vi.mock("./ArticleRevisionRepository", () => ({
  ArticleRevisionRepository: { failRevision: m.failRevision },
}));
import { startGeneration } from "./ArticleGenerationStart";

beforeEach(() => {
  m.create.mockRejectedValue(new Error("connection reset"));
});

it("refunds a draft whose generation run never started", async () => {
  m.get.mockRejectedValue(new Error("instance not found"));
  await startGeneration({ projectId: "p1", jobId: "j1", version: 1 });
  expect(m.update.mock.lastCall?.[2]).toMatchObject({ state: "failed" });
  expect(m.release).toHaveBeenCalledWith("p1", "j1", true);
});

it("leaves the job alone when the run started despite a failed response", async () => {
  m.get.mockResolvedValue({ id: "j1-v2" });
  await startGeneration({ projectId: "p1", jobId: "j1", version: 2 });
  expect(m.failRevision).not.toHaveBeenCalled();
  expect(m.release).not.toHaveBeenCalled();
});
