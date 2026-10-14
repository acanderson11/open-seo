import { ProjectContextService } from "@/server/features/project-context/services/ProjectContextService";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { GscService } from "@/server/features/gsc/services/GscService";
import { ExecutionTaskRepository } from "./ExecutionTaskRepository";
import {
  buildPlanRecommendations,
  CONTENT_QUALITY_CHECKS,
  type PlanInput,
} from "./PlanningRules";

export async function getPlanningPreview(projectId: string) {
  const [context, tasks, auditResult, searchResult] = await Promise.all([
    ProjectContextService.getProjectContext(projectId),
    ExecutionTaskRepository.list(projectId),
    Promise.resolve()
      .then(async () => {
        const audit = await AuditRepository.getLatestAuditForProject(projectId);
        if (!audit) return { state: "missing" as const, pages: 0 };
        const blocked = await AuditRepository.countBlockedPages(audit.id);
        return {
          state: blocked
            ? ("blocked" as const)
            : audit.status !== "completed" ||
                audit.pagesCrawled < audit.pagesTotal ||
                audit.pagesCrawled <= 1
              ? ("incomplete" as const)
              : ("available" as const),
          pages: audit.pagesCrawled,
          observedAt: audit.startedAt,
        };
      })
      .catch(() => ({ state: "unavailable" as const, pages: 0 })),
    GscService.getPerformance({
      projectId,
      dimensions: ["query", "page"],
      dateRange: "last_3_months",
      rowLimit: 200,
      dataState: "final",
    })
      .then((report) => ({
        available: true,
        startDate: report.request.startDate,
        endDate: report.request.endDate,
        rows: report.rows.map((row) => ({
          query: row.keys?.[0] ?? "",
          page: row.keys?.[1] ?? "",
          impressions: row.impressions,
          clicks: row.clicks,
          position: row.position,
        })),
      }))
      .catch(() => ({ available: false, rows: [] })),
  ]);
  const section = (key: string) =>
    context.sections.find((item) => item.key === key)?.content ?? "";
  const input: PlanInput = {
    goal: section("current_goal"),
    targets: section("target_topics"),
    audit: auditResult,
    search: searchResult,
  };
  const active = tasks.filter((task) => task.state !== "done");
  return {
    generatedAt: new Date().toISOString(),
    ...input,
    writingPreferences: section("writing_preferences"),
    recommendations: buildPlanRecommendations(input),
    qualityChecks: CONTENT_QUALITY_CHECKS,
    activeTasks: active
      .slice(0, 50)
      .map((task) => ({ id: task.id, title: task.title, state: task.state })),
    tasksLimited: active.length > 50 || tasks.length > 500,
  };
}
