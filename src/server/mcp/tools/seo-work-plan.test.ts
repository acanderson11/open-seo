import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { getSeoWorkPlanTool } from "./seo-work-plan";
import { makeToolContext } from "./tool-test-support";
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  plan: vi.fn(),
  hosted: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: { getProjectForOrganization: mocks.access },
}));
vi.mock("@/server/features/automation/WorkPlanAgentService", () => ({
  getAgentWorkPlan: mocks.plan,
}));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: mocks.hosted,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ id: "p1" });
  mocks.hosted.mockResolvedValue(false);
  mocks.plan.mockResolvedValue({
    month: "2026-09",
    inventory: { pages: [], totalKnown: 0 },
    limitations: ["Incomplete coverage"],
  });
});
it("returns scoped evidence with a link to the existing work plan", async () => {
  const result = await getSeoWorkPlanTool.handler(
    { projectId: "p1", pageOffset: 20 },
    makeToolContext(),
  );
  expect(mocks.access).toHaveBeenCalledWith("org_123", "p1");
  expect(mocks.plan).toHaveBeenCalledWith("p1", 20);
  expect(
    z
      .object(getSeoWorkPlanTool.config.outputSchema)
      .safeParse(result.structuredContent).success,
  ).toBe(true);
  expect(result.structuredContent.meta?.url).toContain(
    "/p/p1/execution?executionView=plan",
  );
});
it("rejects inaccessible projects before reading any evidence", async () => {
  mocks.access.mockResolvedValue(null);
  await expect(
    getSeoWorkPlanTool.handler(
      { projectId: "foreign", pageOffset: 0 },
      makeToolContext(),
    ),
  ).rejects.toThrow();
  expect(mocks.plan).not.toHaveBeenCalled();
});
it("retains the agency administrator permission gate", async () => {
  await expect(
    getSeoWorkPlanTool.handler(
      { projectId: "p1", pageOffset: 0 },
      makeToolContext({ role: "member" }),
    ),
  ).rejects.toThrow();
  expect(mocks.plan).not.toHaveBeenCalled();
});
it("does not expose the agency extension in hosted mode", async () => {
  mocks.hosted.mockResolvedValue(true);
  await expect(
    getSeoWorkPlanTool.handler(
      { projectId: "p1", pageOffset: 0 },
      makeToolContext(),
    ),
  ).rejects.toThrow();
  expect(mocks.plan).not.toHaveBeenCalled();
});
