import { expect, it, vi } from "vitest";
import { getAgentWorkPlan } from "./WorkPlanAgentService";
const mocks = vi.hoisted(() => ({ plan: vi.fn(), rules: vi.fn() }));
vi.mock("./WorkPlanningService", () => ({ getWorkPlan: mocks.plan }));
vi.mock("./ContentLearningRepository", () => ({
  ContentLearningRepository: { active: mocks.rules },
}));
it("bounds page and guideline evidence without hiding coverage limits", async () => {
  mocks.plan.mockResolvedValue({
    inventory: {
      limited: false,
      pages: Array.from({ length: 45 }, (_, i) => ({
        id: String(i),
        excerpt: "a".repeat(1800),
        readState: i % 2 ? "read" : "unavailable",
        readFailure: i % 2 ? null : "siteground-challenge",
      })),
    },
  });
  mocks.rules.mockResolvedValue(
    Array.from({ length: 31 }, (_, i) => ({
      id: String(i),
      category: "voice",
      instruction: "Use precise examples",
      version: 1,
      projectId: "p1",
    })),
  );
  const result = await getAgentWorkPlan("p1", 20);
  expect(mocks.plan).toHaveBeenCalledWith("p1");
  expect(mocks.rules).toHaveBeenCalledWith("p1");
  expect(result.inventory.totalKnown).toBe(45);
  expect(result.inventory.pages).toHaveLength(20);
  expect(result.inventory.pages[0]?.id).toBe("20");
  expect(result.inventory.pages[0]?.excerpt).toHaveLength(600);
  expect(result.inventory.pages[0]?.readFailure).toBe("siteground-challenge");
  expect(result.inventory.nextPageOffset).toBe(40);
  expect(result.learnedGuidelines).toHaveLength(30);
  expect(result.guidelinesLimited).toBe(true);
});
