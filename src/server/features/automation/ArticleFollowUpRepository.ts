import { and, asc, eq, exists, inArray, lte, notExists, or } from "drizzle-orm";
import { db } from "@/db";
import { articleFollowUps, automationJobs } from "@/db/schema";

const DAY = 86_400_000;
export const FOLLOW_UP_STAGES = [
  ["technical", 0],
  ["indexing_3", 3],
  ["indexing_7", 7],
  ["metrics_14", 14],
  ["metrics_30", 30],
  ["reassess_60", 60],
  ["reassess_90", 90],
] as const;
export type FollowUp = typeof articleFollowUps.$inferSelect;
export type PublishedJob = Pick<
  typeof automationJobs.$inferSelect,
  "id" | "projectId" | "publishedUrl" | "publishedAt"
>;

export const ArticleFollowUpRepository = {
  list(projectId: string, jobIds: string[]) {
    if (jobIds.length === 0) return Promise.resolve([]);
    return db
      .select({
        id: articleFollowUps.id,
        jobId: articleFollowUps.jobId,
        stage: articleFollowUps.stage,
        dueAt: articleFollowUps.dueAt,
        baselineAt: articleFollowUps.baselineAt,
        scheduleBasis: articleFollowUps.scheduleBasis,
        state: articleFollowUps.state,
        checkedAt: articleFollowUps.checkedAt,
        outcome: articleFollowUps.outcome,
        detail: articleFollowUps.detail,
        clicks: articleFollowUps.clicks,
        impressions: articleFollowUps.impressions,
        taskId: articleFollowUps.taskId,
      })
      .from(articleFollowUps)
      .where(
        and(
          eq(articleFollowUps.projectId, projectId),
          inArray(articleFollowUps.jobId, jobIds),
        ),
      )
      .orderBy(asc(articleFollowUps.dueAt))
      .limit(jobIds.length * FOLLOW_UP_STAGES.length);
  },

  async seedPublishedJobs(now: Date) {
    // The last stage is inserted last. A crash during any earlier insert leaves
    // it absent, so the next tick repairs a partially seeded article.
    const candidates = await db
      .select({
        id: automationJobs.id,
        projectId: automationJobs.projectId,
        publishedAt: automationJobs.publishedAt,
        publishedUrl: automationJobs.publishedUrl,
      })
      .from(automationJobs)
      .where(
        and(
          eq(automationJobs.state, "published"),
          notExists(
            db
              .select({ id: articleFollowUps.id })
              .from(articleFollowUps)
              .where(
                and(
                  eq(articleFollowUps.jobId, automationJobs.id),
                  eq(articleFollowUps.stage, "reassess_90"),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(automationJobs.publishedAt))
      .limit(20);
    for (const job of candidates) {
      if (!job.publishedUrl) continue;
      // If there was a partial insert for a legacy article, retain its
      // original monitoring baseline rather than moving the schedule.
      const [existing] = await db
        .select({ baselineAt: articleFollowUps.baselineAt })
        .from(articleFollowUps)
        .where(eq(articleFollowUps.jobId, job.id))
        .limit(1);
      const start = existing
        ? Date.parse(existing.baselineAt)
        : job.publishedAt
          ? Date.parse(job.publishedAt)
          : now.getTime();
      if (!Number.isFinite(start)) continue;
      const scheduleBasis = job.publishedAt ? "publication" : "monitoring";
      for (const [stage, day] of FOLLOW_UP_STAGES) {
        await db
          .insert(articleFollowUps)
          .values({
            id: crypto.randomUUID(),
            projectId: job.projectId,
            jobId: job.id,
            stage,
            dueAt: new Date(start + day * DAY).toISOString(),
            baselineAt: new Date(start).toISOString(),
            scheduleBasis,
          })
          .onConflictDoNothing();
      }
    }
  },

  due(now: Date) {
    return db
      .select()
      .from(articleFollowUps)
      .where(
        and(
          lte(articleFollowUps.dueAt, now.toISOString()),
          or(
            eq(articleFollowUps.state, "pending"),
            and(
              eq(articleFollowUps.state, "running"),
              lte(articleFollowUps.leaseUntil, now.toISOString()),
            ),
          ),
        ),
      )
      .orderBy(asc(articleFollowUps.dueAt))
      .limit(4);
  },

  async claim(followUp: FollowUp, leaseUntil: string) {
    const [claimed] = await db
      .update(articleFollowUps)
      .set({ state: "running", leaseUntil, attempts: followUp.attempts + 1 })
      .where(
        and(
          eq(articleFollowUps.id, followUp.id),
          eq(articleFollowUps.state, followUp.state),
          eq(articleFollowUps.attempts, followUp.attempts),
        ),
      )
      .returning({ id: articleFollowUps.id });
    return !!claimed;
  },

  async publishedJob(jobId: string): Promise<PublishedJob | null> {
    const [job] = await db
      .select({
        id: automationJobs.id,
        projectId: automationJobs.projectId,
        publishedUrl: automationJobs.publishedUrl,
        publishedAt: automationJobs.publishedAt,
      })
      .from(automationJobs)
      .where(
        and(
          eq(automationJobs.id, jobId),
          eq(automationJobs.state, "published"),
        ),
      )
      .limit(1);
    return job ?? null;
  },

  async finish(
    followUp: FollowUp,
    leaseUntil: string,
    result: {
      state: "pending" | "complete" | "unavailable";
      dueAt?: string;
      outcome: string;
      detail: string;
      clicks?: number;
      impressions?: number;
      taskId?: string | null;
    },
  ) {
    await db
      .update(articleFollowUps)
      .set({
        state: result.state,
        dueAt: result.dueAt ?? followUp.dueAt,
        leaseUntil: null,
        checkedAt: new Date().toISOString(),
        outcome: result.outcome,
        detail: result.detail,
        clicks: result.clicks ?? null,
        impressions: result.impressions ?? null,
        taskId: result.taskId ?? null,
      })
      .where(
        and(
          eq(articleFollowUps.id, followUp.id),
          eq(articleFollowUps.leaseUntil, leaseUntil),
        ),
      );
  },

  async retryUnavailable(projectId: string, id: string, now: string) {
    const [row] = await db
      .update(articleFollowUps)
      .set({
        state: "pending",
        attempts: 0,
        leaseUntil: null,
        dueAt: now,
        checkedAt: null,
        outcome: null,
        detail: null,
      })
      .where(
        and(
          eq(articleFollowUps.projectId, projectId),
          eq(articleFollowUps.id, id),
          eq(articleFollowUps.state, "unavailable"),
          exists(
            db
              .select({ id: automationJobs.id })
              .from(automationJobs)
              .where(
                and(
                  eq(automationJobs.id, articleFollowUps.jobId),
                  eq(automationJobs.state, "published"),
                ),
              ),
          ),
        ),
      )
      .returning({ id: articleFollowUps.id });
    return !!row;
  },
};
