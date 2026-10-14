import { sort } from "remeda";
import { seedInventory, refreshInventoryBatch } from "./InventoryService";
import { InventoryRepository } from "./InventoryRepository";
import { needsInventoryRead, topicOverlap } from "./InventoryRules";
import { ContentLearningRepository as learning } from "./ContentLearningRepository";
import { AutopilotRepository as auto } from "./AutopilotRepository";
import { AutomationRepository as jobs } from "./AutomationRepository";
import {
  contextSnapshot,
  startDraft,
  validateTarget,
} from "./AutomationService";
import { boundedJson } from "./WordpressPublication";
import { GscService } from "@/server/features/gsc/services/GscService";
import { SearchOpportunityService } from "@/server/features/ga4/services/SearchOpportunityService";
import { ProjectContextService } from "@/server/features/project-context/services/ProjectContextService";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { discoverSiteUrls, readPages } from "@/server/lib/scrape";
import {
  getOptionalEnvValue,
  isHostedServerAuthMode,
} from "@/server/lib/runtime-env";
import { plannerResult, dueForDraft } from "@/types/schemas/autopilot";
import { AppError } from "@/server/lib/errors";
import { notifyReviewer } from "./DraftReviewService";
export async function callExecutionHook(
  path: "openseo-plan-content" | "openseo-review-notification",
  payload: unknown,
) {
  const secret = await getOptionalEnvValue("AGENCY_N8N_EXECUTION_SECRET");
  if (!secret) throw new AppError("AUTH_CONFIG_MISSING");
  return boundedJson(
    await fetch(`https://n8n.andmktg.com/webhook/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-openseo-execution-secret": secret,
      },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(90000),
    }),
  );
}
export async function collectPlanningInput(projectId: string) {
  const project = await ProjectRepository.getProjectById(projectId);
  if (!project?.domain) throw new AppError("NOT_FOUND");
  // Every scheduled planning run incrementally refreshes up to five pages.
  await seedInventory(projectId);
  await refreshInventoryBatch(projectId);
  const [context, snapshot, recent, inventory, storedPages] = await Promise.all(
    [
      ProjectContextService.getProjectContext(projectId),
      contextSnapshot(projectId),
      auto.recentTopics(projectId),
      discoverSiteUrls(project.domain, 100),
      InventoryRepository.list(projectId),
    ],
  );
  const reports = await Promise.allSettled([
    GscService.getPerformance({
      projectId,
      dimensions: ["query", "page"],
      dateRange: "last_3_months",
      rowLimit: 200,
      dataState: "final",
    }),
    SearchOpportunityService.getOpportunities({ projectId, limit: 30 }),
  ]);
  const gsc = reports[0].status === "fulfilled" ? reports[0].value.rows : [];
  const opportunities =
    reports[1].status === "fulfilled" ? reports[1].value.rows : [];
  const targets =
    context.sections.find((section) => section.key === "target_topics")
      ?.content ?? "";
  const evidence = [
    ...gsc.map((row, index) => ({
      id: `gsc-${index}`,
      kind: "search_performance",
      data: row,
    })),
    ...opportunities.map((row, index) => ({
      id: `opportunity-${index}`,
      kind: "scored_opportunity",
      data: row,
    })),
    ...(targets.trim()
      ? [{ id: "business-targets", kind: "business_priority", data: targets }]
      : []),
  ];
  if (!evidence.length)
    throw new AppError(
      "VALIDATION_ERROR",
      "Connect search data or add target topics in Context before enabling automatic planning.",
    );
  const currentPages = storedPages.filter(
    (page) => page.readState === "read" && !needsInventoryRead(page),
  );
  const rankedPages = sort(
    currentPages.map((page) => ({ page, score: topicOverlap(targets, page) })),
    (a, b) => b.score - a.score,
  );
  const sourceUrls = [
    ...new Set([
      `https://${project.domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/`,
      ...rankedPages.map(({ page }) => page.url),
      ...context.keyPages.map((page) => page.url),
      ...inventory.urls,
    ]),
  ]
    .flatMap((url) => {
      try {
        return [validateTarget(url, project.domain!)];
      } catch {
        return [];
      }
    })
    .slice(0, 5);
  const source = currentPages.length
    ? {
        pages: rankedPages.slice(0, 5).map(({ page }) => ({
          url: page.url,
          title: page.title,
          text: page.content,
        })),
      }
    : await readPages(sourceUrls, 5);
  if (!source.pages.length) throw new AppError("UPSTREAM_UNAVAILABLE");
  return {
    projectId,
    domain: project.domain,
    context: snapshot.rendered,
    contextVersion: snapshot.version,
    evidence,
    sources: source.pages,
    existingPages: [
      ...new Set([...storedPages.map((page) => page.url), ...inventory.urls]),
    ].slice(0, 500),
    pageInventory: currentPages.map((page) => ({
      url: page.url,
      title: page.title,
      heading: page.heading,
      purpose: page.purpose,
      readAt: page.contentAt,
    })),
    recentTopics: recent,
    dataCoverage: {
      gsc: reports[0].status,
      ga4: reports[1].status,
      inventoryTruncated:
        storedPages.length >= 500 || inventory.urls.length >= 100,
      inventoryReadPages: currentPages.length,
    },
    policyVersion: (await jobs.policy(projectId))?.version,
  };
}
export async function selectOpportunity(
  input: Awaited<ReturnType<typeof collectPlanningInput>>,
) {
  const result = plannerResult.parse(
    await callExecutionHook("openseo-plan-content", input),
  );
  if (
    result.projectId !== input.projectId ||
    result.contextVersion !== input.contextVersion
  )
    throw new AppError("CONFLICT");
  if (result.selection.action === "draft") {
    const selection = result.selection;
    const overlap = input.pageInventory.find(
      (page) => topicOverlap(selection.topic, page) >= 0.8,
    );
    if (overlap)
      return {
        action: "skip" as const,
        reason: `Potential existing coverage at ${overlap.url}. Review the work plan for an existing-page improvement before creating another article.`,
      };
    if (
      selection.evidenceIds.some(
        (id) => !input.evidence.some((row) => row.id === id),
      ) ||
      selection.sourceUrls.some(
        (url) => !input.sources.some((source) => source.url === url),
      )
    )
      throw new AppError("VALIDATION_ERROR");
    if (
      input.recentTopics.some(
        (item) =>
          item.topic.toLowerCase().trim() ===
          selection.topic.toLowerCase().trim(),
      )
    )
      throw new AppError("CONFLICT");
  }
  return result.selection;
}
export async function producePlannedDraft(
  runId: string,
  input: Awaited<ReturnType<typeof collectPlanningInput>>,
  selection: Awaited<ReturnType<typeof selectOpportunity>>,
) {
  const policy = await jobs.policy(input.projectId),
    connection = await auto.wordpress(input.projectId),
    snapshot = await contextSnapshot(input.projectId);
  if (
    !policy?.enabled ||
    !policy.autopilot ||
    policy.version !== input.policyVersion ||
    snapshot.version !== input.contextVersion ||
    (policy.delivery === "wordpress" && !connection)
  )
    throw new AppError("CONFLICT");
  if (selection.action === "skip") {
    await auto.status(input.projectId, selection.reason);
    await auto.finishRun(runId, "skipped", selection.reason);
    return null;
  }
  const job = await startDraft(
    input.projectId,
    input.domain,
    "autopilot",
    {
      projectId: input.projectId,
      requestKey: runId,
      topic: selection.topic,
      targetUrl: selection.sourceUrls[0],
    },
    {
      rationale:
        selection.rationale + " Evidence: " + selection.evidenceIds.join(", "),
      sourceUrls: selection.sourceUrls,
      wordpressVersion:
        policy.delivery === "wordpress" ? connection?.version : undefined,
    },
  );
  await auto.finishRun(
    runId,
    job?.state ?? "failed",
    job?.message ?? "Draft processing complete.",
  );
  await auto.status(
    input.projectId,
    job?.state === "awaiting_approval"
      ? "Article ready for approval."
      : "Latest article needs attention on the execution board.",
  );
  return job
    ? { projectId: job.projectId, id: job.id, state: job.state }
    : null;
}
export async function notifyPlannedDraft(
  job: {
    projectId: string;
    id: string;
    state: string;
  } | null,
) {
  if (job?.state === "awaiting_approval")
    await notifyReviewer(job.projectId, job.id);
}
export async function scheduleAutopilot(env: Env) {
  if (await isHostedServerAuthMode()) return;
  for (const job of await learning.queued()) {
    const policy = await jobs.policy(job.projectId);
    if (
      !policy?.enabled ||
      policy.busyJobId ||
      (policy.period === new Date().toISOString().slice(0, 7) &&
        policy.used >= policy.monthlyLimit)
    )
      continue;
    const run = await auto.reserveRun(
      job.projectId,
      "revision:" + job.id + ":" + job.version + ":" + job.revisionRequest,
    );
    if (!run) continue;
    try {
      await env.CONTENT_AUTOPILOT_WORKFLOW.create({
        id: run.id,
        params: {
          runId: run.id,
          projectId: job.projectId,
          revisionJobId: job.id,
          revisionVersion: job.version,
        },
      });
    } catch {
      await jobs.update(job.projectId, job.id, {
        state: "needs_revision",
        message:
          "Revision workflow start could not be verified. Agency attention required; no automatic retry.",
      });
      await auto.finishRun(
        run.id,
        "dispatch_unknown",
        "Revision start could not be verified.",
      );
    }
  }
  const now = new Date(),
    day = now.toISOString().slice(0, 10);
  for (const project of await auto.projects()) {
    const policy = await jobs.policy(project.id);
    if (!policy || policy.busyJobId) continue;
    const stats = await auto.stats(project.id, day.slice(0, 7));
    if (
      stats.attempts >= policy.monthlyLimit ||
      !dueForDraft(policy.monthlyTarget, stats.completed, now)
    )
      continue;
    const run = await auto.reserveRun(project.id, day);
    if (!run) continue;
    try {
      await env.CONTENT_AUTOPILOT_WORKFLOW.create({
        id: run.id,
        params: { runId: run.id, projectId: project.id },
      });
    } catch {
      await auto.finishRun(
        run.id,
        "dispatch_unknown",
        "Workflow start could not be confirmed. No duplicate launch attempted.",
      );
      await auto.status(
        project.id,
        "Automatic planning dispatch needs attention.",
      );
    }
  }
}
