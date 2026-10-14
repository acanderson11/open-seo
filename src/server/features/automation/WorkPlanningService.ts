import { inventorySnapshot } from "./InventoryService";
import { getPlanningPreview } from "./PlanningService";
import { buildWorkPlan } from "./WorkPlanRules";
import { evidenceHash } from "./InventoryRules";
import { ExecutionTaskRepository as tasks } from "./ExecutionTaskRepository";
import { SearchOpportunityService } from "@/server/features/ga4/services/SearchOpportunityService";
import { AppError } from "@/server/lib/errors";
export async function getWorkPlan(projectId: string) {
  const [base, inventory, conversionResult, existingTasks] = await Promise.all([
    getPlanningPreview(projectId),
    inventorySnapshot(projectId),
    SearchOpportunityService.getOpportunities({ projectId, limit: 30 }).catch(
      () => null,
    ),
    tasks.list(projectId),
  ]);
  const month = new Date().toISOString().slice(0, 7);
  const suggestions = buildWorkPlan({
    inventory,
    targets: base.targets,
    goal: base.goal,
    search: base.search,
  });
  const recommendations = await Promise.all(
    suggestions.map(async (item) => {
      const id = await evidenceHash(item.id),
        fingerprint = await evidenceHash(JSON.stringify(item));
      const existing = existingTasks.find(
        (task) =>
          task.requestKey === `plan:${month}:${id}` ||
          (task.state !== "done" &&
            task.requestKey.startsWith("plan:") &&
            task.requestKey.endsWith(`:${id}`)),
      );
      return { ...item, id, fingerprint, taskId: existing?.id ?? null };
    }),
  );
  const incoming = new Map<string, number>(),
    outgoing = new Map<string, number>();
  for (const link of inventory.links) {
    incoming.set(link.targetUrl, (incoming.get(link.targetUrl) ?? 0) + 1);
    outgoing.set(link.pageId, (outgoing.get(link.pageId) ?? 0) + 1);
  }
  return {
    ...base,
    month,
    recommendations,
    inventory: {
      limited: inventory.limited,
      pages: inventory.pages.map(({ content, ...page }) => ({
        ...page,
        excerpt: content.slice(0, 1800),
        incoming: incoming.get(page.url) ?? 0,
        outgoing: outgoing.get(page.id) ?? 0,
      })),
      auditAt:
        inventory.audit?.completedAt ?? inventory.audit?.startedAt ?? null,
    },
    conversions:
      conversionResult?.status === "ok"
        ? {
            available: true as const,
            request: conversionResult.request,
            metric: conversionResult.scoring.businessValueMetric,
            limited: conversionResult.scoring.scoreDataLimited,
            rows: conversionResult.rows.map((r) => ({
              page: r.page,
              sessions: r.ga4?.sessions ?? null,
              keyEvents: r.ga4?.keyEvents ?? null,
              score: r.score,
            })),
            warnings: conversionResult.warnings,
          }
        : { available: false as const },
  };
}
export async function acceptWorkRecommendation(
  projectId: string,
  actorId: string,
  input: { id: string; fingerprint: string; month: string },
) {
  if (input.month !== new Date().toISOString().slice(0, 7))
    throw new AppError("CONFLICT");
  const requestKey = `plan:${input.month}:${input.id}`;
  const existing = await tasks.byRequest(projectId, requestKey);
  if (existing) return existing;
  const plan = await getWorkPlan(projectId),
    item = plan.recommendations.find((r) => r.id === input.id);
  if (!item || item.fingerprint !== input.fingerprint)
    throw new AppError("CONFLICT");
  if (item.taskId)
    return (
      (await tasks.list(projectId)).find((task) => task.id === item.taskId) ??
      null
    );
  const now = new Date().toISOString();
  const description = [
    `Plan: ${input.month} | ${item.kind} | ${item.confidence} confidence | ${item.effort} effort`,
    item.targetUrl ? `Page: ${item.targetUrl}` : "",
    `Evidence: ${item.evidence}`,
    `Business value: ${item.businessValue}`,
    `Proposed work: ${item.action}`,
    `Completion check: ${item.objective}`,
    `Accepted ${now}. This task does not authorize automatic publication or website changes.`,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 4000);
  return (
    (await tasks.create({
      id: crypto.randomUUID(),
      projectId,
      actorId,
      requestKey,
      title: item.title,
      description,
      category: item.category,
      priority: item.priority,
      state: "todo",
      version: 1,
      createdAt: now,
      updatedAt: now,
    })) ?? (await tasks.byRequest(projectId, requestKey))
  );
}
