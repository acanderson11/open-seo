import { technicalCheck } from "./ArticleFollowUpTechnicalCheck";
import { GscService } from "@/server/features/gsc/services/GscService";
import { ExecutionTaskRepository } from "./ExecutionTaskRepository";
import {
  ArticleFollowUpRepository as followUps,
  type FollowUp,
  type PublishedJob,
} from "./ArticleFollowUpRepository";

const DAY = 86_400_000;
type Check = {
  outcome: string;
  detail: string;
  clicks?: number;
  impressions?: number;
  issue?: string;
};
const pacificDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function gscDate(date: Date) {
  const parts = Object.fromEntries(
    pacificDate.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function listArticleFollowUps(
  projectId: string,
  jobIds: string[],
) {
  return followUps.list(projectId, jobIds);
}

export async function retryArticleFollowUp(projectId: string, id: string) {
  return followUps.retryUnavailable(projectId, id, new Date().toISOString());
}

async function gscCheck(
  job: PublishedJob,
  followUp: FollowUp,
  now: Date,
): Promise<Check> {
  if (!job.publishedUrl)
    return { outcome: "unavailable", detail: "No published URL is recorded." };
  try {
    const { stage } = followUp;
    if (stage.startsWith("indexing")) {
      const result = (
        await GscService.inspectUrls({
          projectId: job.projectId,
          urls: [job.publishedUrl],
        })
      ).results[0];
      if (!result?.result)
        return {
          outcome: "unavailable",
          detail:
            result?.error ?? "Search Console returned no inspection data.",
        };
      const index = result.result.indexStatusResult;
      const detail = [
        index?.coverageState,
        index?.indexingState,
        index?.lastCrawlTime ? `Last crawled ${index.lastCrawlTime}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        outcome: index?.verdict === "PASS" ? "indexed" : "observed",
        detail:
          detail || "Search Console did not provide a definitive index status.",
      };
    }
    const end = new Date(now.getTime() - 3 * DAY);
    const isReassessment = stage.startsWith("reassess");
    const baseline = new Date(followUp.baselineAt);
    const publication = job.publishedAt ? new Date(job.publishedAt) : baseline;
    const start = isReassessment
      ? new Date(end.getTime() - 27 * DAY)
      : publication;
    const query = (startDate: Date, endDate: Date) =>
      GscService.getPerformance({
        projectId: job.projectId,
        dimensions: ["page"],
        startDate: gscDate(startDate),
        endDate: gscDate(endDate),
        filters: [
          {
            dimension: "page",
            operator: "equals",
            expression: job.publishedUrl!,
          },
        ],
        rowLimit: 1,
        dataState: "final",
      });
    const result = await query(start, end);
    const row = result.rows[0];
    if (!row)
      return {
        outcome: "no_data",
        detail:
          "Search Console has no final page data for this period. Performance cannot yet be judged.",
      };
    if (isReassessment) {
      const previousEnd = new Date(start.getTime() - DAY);
      const previousStart = new Date(previousEnd.getTime() - 27 * DAY);
      const previous = (await query(previousStart, previousEnd)).rows[0];
      return {
        outcome: "observed",
        detail: previous
          ? `Recent 28 days: ${row.clicks} clicks, ${row.impressions} impressions. Prior 28 days: ${previous.clicks} clicks, ${previous.impressions} impressions. Review context before deciding on revisions.`
          : `Recent 28 days: ${row.clicks} clicks, ${row.impressions} impressions. No comparable prior period is available.`,
        clicks: row.clicks,
        impressions: row.impressions,
      };
    }
    const queries = await GscService.getPerformance({
      projectId: job.projectId,
      dimensions: ["query"],
      startDate: gscDate(start),
      endDate: gscDate(end),
      filters: [
        { dimension: "page", operator: "equals", expression: job.publishedUrl },
      ],
      rowLimit: 3,
      dataState: "final",
    });
    const topQueries = queries.rows
      .map((item) => item.keys?.[0])
      .filter(Boolean)
      .join(", ");
    return {
      outcome: "observed",
      detail: `${row.clicks} clicks and ${row.impressions} impressions in Search Console.${topQueries ? ` Leading queries: ${topQueries}.` : ""}`,
      clicks: row.clicks,
      impressions: row.impressions,
    };
  } catch {
    return {
      outcome: "unavailable",
      detail: "Search Console data is unavailable or access needs attention.",
    };
  }
}

async function createIssueTask(
  job: PublishedJob,
  stage: FollowUp["stage"],
  issue: string,
) {
  const requestKey = `article-follow-up:${job.id}:${stage}`;
  const now = new Date().toISOString();
  const task = await ExecutionTaskRepository.create({
    id: crypto.randomUUID(),
    projectId: job.projectId,
    actorId: "system:article-follow-up",
    requestKey,
    title: "Review published article technical issue",
    description: `${issue}\n\nArticle: ${job.publishedUrl}\nEvidence checked ${now}. Agency review is required; no website changes were made.`,
    category: "technical",
    priority: "high",
    state: "todo",
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  return (
    task?.id ??
    (await ExecutionTaskRepository.byRequest(job.projectId, requestKey))?.id ??
    null
  );
}

/** Small, lease-claimed cron batch. Article state remains published throughout. */
export async function runScheduledArticleFollowUps() {
  const now = new Date();
  await followUps.seedPublishedJobs(now);
  const due = await followUps.due(now);
  for (const followUp of due) {
    const leaseUntil = new Date(Date.now() + 10 * 60_000).toISOString();
    if (!(await followUps.claim(followUp, leaseUntil))) continue;
    try {
      const job = await followUps.publishedJob(followUp.jobId);
      const check: Check = !job?.publishedUrl
        ? {
            outcome: "unavailable",
            detail: "The article is no longer recorded as published.",
          }
        : followUp.stage === "technical"
          ? await technicalCheck(job.publishedUrl)
          : await gscCheck(job, followUp, now);
      const taskId =
        check.issue && job
          ? await createIssueTask(job, followUp.stage, check.issue)
          : null;
      const retry = check.outcome === "unavailable" && followUp.attempts < 2;
      await followUps.finish(followUp, leaseUntil, {
        state: retry
          ? "pending"
          : check.outcome === "unavailable"
            ? "unavailable"
            : "complete",
        outcome: check.outcome,
        detail: check.detail,
        clicks: check.clicks,
        impressions: check.impressions,
        taskId,
        ...(retry ? { dueAt: new Date(Date.now() + DAY).toISOString() } : {}),
      });
    } catch (error) {
      console.error("[article-follow-up] check failed", {
        id: followUp.id,
        error,
      });
      await followUps.finish(followUp, leaseUntil, {
        state: followUp.attempts >= 2 ? "unavailable" : "pending",
        dueAt: new Date(Date.now() + DAY).toISOString(),
        outcome: "unavailable",
        detail:
          followUp.attempts >= 2
            ? "The check failed after three attempts."
            : "The check failed and will retry tomorrow.",
      });
    }
  }
}
