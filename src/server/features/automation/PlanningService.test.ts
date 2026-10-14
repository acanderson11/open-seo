import { beforeEach, describe, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({
  context: vi.fn(),
  tasks: vi.fn(),
  audit: vi.fn(),
  blocked: vi.fn(),
  search: vi.fn(),
}));
vi.mock(
  "@/server/features/project-context/services/ProjectContextService",
  () => ({ ProjectContextService: { getProjectContext: mock.context } }),
);
vi.mock("./ExecutionTaskRepository", () => ({
  ExecutionTaskRepository: { list: mock.tasks },
}));
vi.mock("@/server/features/audit/repositories/AuditRepository", () => ({
  AuditRepository: {
    getLatestAuditForProject: mock.audit,
    countBlockedPages: mock.blocked,
  },
}));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: mock.search },
}));
import { getPlanningPreview } from "./PlanningService";
beforeEach(() => {
  vi.resetAllMocks();
  mock.context.mockResolvedValue({
    sections: [
      { key: "current_goal", content: "Qualified consultations" },
      { key: "target_topics", content: "CRM setup" },
      { key: "writing_preferences", content: "Direct, practical" },
    ],
  });
  mock.tasks.mockResolvedValue([]);
  mock.audit.mockResolvedValue({
    id: "a1",
    status: "completed",
    pagesCrawled: 10,
    pagesTotal: 10,
    startedAt: "2026-09-26",
  });
  mock.blocked.mockResolvedValue(0);
  mock.search.mockResolvedValue({
    request: { startDate: "2026-06-23", endDate: "2026-09-23" },
    rows: [
      {
        keys: ["crm setup", "https://example.com/old"],
        impressions: 100,
        clicks: 1,
        position: 12,
      },
    ],
  });
});
describe("read-only planning evidence", () => {
  it("scopes every source to the authorized project and preserves dates", async () => {
    const result = await getPlanningPreview("p1");
    expect(mock.context).toHaveBeenCalledWith("p1");
    expect(mock.tasks).toHaveBeenCalledWith("p1");
    expect(mock.audit).toHaveBeenCalledWith("p1");
    expect(mock.search).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", rowLimit: 200 }),
    );
    expect(result.search.startDate).toBe("2026-06-23");
    expect(result.writingPreferences).toBe("Direct, practical");
  });
  it("routes blocked completed audits to investigation rather than page repair", async () => {
    mock.blocked.mockResolvedValue(1);
    const r = await getPlanningPreview("p1");
    expect(r.audit.state).toBe("blocked");
    expect(r.recommendations.find((i) => i.id === "crawl")?.action).toContain(
      "cannot establish missing headings",
    );
  });
  it("keeps unavailable search distinct from a report with no rows", async () => {
    mock.search.mockRejectedValue(new Error("private upstream detail"));
    const r = await getPlanningPreview("p1");
    expect(r.search.available).toBe(false);
    expect(r.recommendations.some((i) => i.id === "search")).toBe(true);
    expect(JSON.stringify(r)).not.toContain("private upstream detail");
  });
  it("requests demand research for an empty but successful report", async () => {
    mock.search.mockResolvedValue({
      request: { startDate: "2026-06-23", endDate: "2026-09-23" },
      rows: [],
    });
    const r = await getPlanningPreview("p1");
    expect(r.search.available).toBe(true);
    expect(r.recommendations.find((i) => i.id === "mapping")?.title).toContain(
      "Research demand",
    );
  });
  it("treats incomplete audit coverage as incomplete", async () => {
    mock.audit.mockResolvedValue({
      id: "a1",
      status: "completed",
      pagesCrawled: 2,
      pagesTotal: 20,
      startedAt: "2026-09-26",
    });
    expect((await getPlanningPreview("p1")).audit.state).toBe("incomplete");
  });
  it("does not turn a historical search row into a verified live defect", async () => {
    const r = await getPlanningPreview("p1");
    expect(
      r.recommendations.find((i) => i.id === "mapping")?.evidence,
    ).toContain("availability has not been checked");
  });
  it("exposes task truncation and excludes completed work", async () => {
    mock.tasks.mockResolvedValue([
      { id: "done", title: "Complete", state: "done" },
      ...Array.from({ length: 51 }, (_, i) => ({
        id: String(i),
        title: "Existing work",
        state: "todo",
      })),
    ]);
    const r = await getPlanningPreview("p1");
    expect(r.activeTasks).toHaveLength(50);
    expect(r.tasksLimited).toBe(true);
    expect(r.activeTasks.some((t) => t.id === "done")).toBe(false);
  });
});
