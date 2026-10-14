import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  preview: vi.fn(),
  inventory: vi.fn(),
  conversions: vi.fn(),
  byRequest: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
}));
vi.mock("./PlanningService", () => ({ getPlanningPreview: m.preview }));
vi.mock("./InventoryService", () => ({ inventorySnapshot: m.inventory }));
vi.mock("@/server/features/ga4/services/SearchOpportunityService", () => ({
  SearchOpportunityService: { getOpportunities: m.conversions },
}));
vi.mock("./ExecutionTaskRepository", () => ({
  ExecutionTaskRepository: {
    byRequest: m.byRequest,
    create: m.create,
    list: m.list,
  },
}));
import { getWorkPlan, acceptWorkRecommendation } from "./WorkPlanningService";
beforeEach(() => {
  vi.resetAllMocks();
  m.preview.mockResolvedValue({
    targets: "CRM services",
    goal: "Qualified leads",
    search: { available: false, rows: [] },
  });
  m.inventory.mockResolvedValue({
    pages: [],
    links: [],
    audit: null,
    evidence: { pages: [], issues: [] },
    limited: false,
  });
  m.conversions.mockRejectedValue(new Error("secret upstream detail"));
  m.byRequest.mockResolvedValue(null);
  m.list.mockResolvedValue([]);
  m.create.mockImplementation(async (value: unknown) => value);
});
it("keeps unavailable conversions explicit without leaking upstream errors", async () => {
  const p = await getWorkPlan("p1");
  expect(p.conversions.available).toBe(false);
  expect(JSON.stringify(p)).not.toContain("secret upstream");
  expect(m.inventory).toHaveBeenCalledWith("p1");
});
it("accepts only server-derived, unchanged recommendations", async () => {
  const plan = await getWorkPlan("p1"),
    r = plan.recommendations[0];
  await expect(
    acceptWorkRecommendation("p1", "actor", {
      id: r.id,
      month: plan.month,
      fingerprint: "changed",
    }),
  ).rejects.toThrow("CONFLICT");
  expect(m.create).not.toHaveBeenCalled();
  await acceptWorkRecommendation("p1", "actor", {
    id: r.id,
    month: plan.month,
    fingerprint: r.fingerprint,
  });
  expect(m.create).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: "p1",
      actorId: "actor",
      state: "todo",
      title: r.title,
    }),
  );
});
it("replays an existing accepted task without creating a duplicate", async () => {
  m.byRequest.mockResolvedValue({ id: "existing" });
  expect(
    await acceptWorkRecommendation("p1", "actor", {
      id: "r",
      month: new Date().toISOString().slice(0, 7),
      fingerprint: "old",
    }),
  ).toEqual({ id: "existing" });
  expect(m.create).not.toHaveBeenCalled();
});
it("rejects acceptance for an older month", async () => {
  await expect(
    acceptWorkRecommendation("p1", "actor", {
      id: "r",
      month: "2000-01",
      fingerprint: "f",
    }),
  ).rejects.toThrow("CONFLICT");
  expect(m.create).not.toHaveBeenCalled();
});
