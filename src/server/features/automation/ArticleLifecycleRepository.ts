import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { REMOVABLE_DRAFT_STATES } from "@/types/schemas/executionBoard";
import { runBatch } from "@/db/runBatch";
import {
  automationJobs as jobs,
  automationApprovals as approvals,
  automationReviewLinks as links,
  articleFeaturedImages as images,
} from "@/db/schema";
/** Approved articles a person can copy and publish by hand: manual delivery, or a WordPress publish that stopped before sending anything. */
export const MANUAL_DELIVERY_STATES = [
  "ready_for_manual_publication",
  "publication_blocked",
];
export const ArticleLifecycleRepository = {
  /** Hides a blocked or in-review article from the board; its history stays. */
  async remove(projectId: string, jobId: string, version: number) {
    return (
      (
        await db
          .update(jobs)
          .set({ state: "removed" })
          .where(
            and(
              eq(jobs.projectId, projectId),
              eq(jobs.id, jobId),
              eq(jobs.version, version),
              inArray(jobs.state, REMOVABLE_DRAFT_STATES),
            ),
          )
          .returning({ id: jobs.id })
      ).length === 1
    );
  },
  async reopen(
    projectId: string,
    jobId: string,
    version: number,
    actorId: string,
  ) {
    const token = crypto.randomUUID(),
      now = new Date().toISOString();
    const scope = and(
      eq(jobs.projectId, projectId),
      eq(jobs.id, jobId),
      eq(jobs.version, version),
    );
    const won = sql`exists(select 1 from ${jobs} where ${jobs.id} = ${jobId} and ${jobs.projectId} = ${projectId} and ${jobs.notificationState} = ${token})`;
    await runBatch((tx) => [
      tx
        .update(jobs)
        .set({
          state: "awaiting_approval",
          notificationState: token,
          message:
            "Approval withdrawn. Draft reopened for feedback and fresh approval. Nothing has been published.",
        })
        .where(
          and(
            scope,
            inArray(jobs.state, [
              "ready_for_manual_publication",
              "ready_to_publish",
              "publication_blocked",
            ]),
            isNull(jobs.publishedUrl),
            isNull(jobs.wordpressPostId),
          ),
        ),
      tx
        .update(approvals)
        .set({ revokedAt: now, revokedBy: actorId })
        .where(
          and(
            eq(approvals.projectId, projectId),
            eq(approvals.jobId, jobId),
            eq(approvals.artifactVersion, version),
            isNull(approvals.revokedAt),
            won,
          ),
        ),
      tx
        .update(links)
        .set({ usedAt: now })
        .where(
          and(
            eq(links.projectId, projectId),
            eq(links.jobId, jobId),
            eq(links.artifactVersion, version),
            isNull(links.usedAt),
            won,
          ),
        ),
    ]);
    const changed = !!(
      await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(scope, eq(jobs.notificationState, token)))
    )[0];
    if (changed)
      await db
        .update(jobs)
        .set({ notificationState: null })
        .where(and(scope, eq(jobs.notificationState, token)));
    return changed;
  },
  async complete(
    projectId: string,
    jobId: string,
    version: number,
    url: string,
  ) {
    return (
      (
        await db
          .update(jobs)
          .set({
            state: "published",
            publishedUrl: url,
            publishedAt: new Date().toISOString(),
            message: "Marked as manually published by the agency.",
          })
          .where(
            and(
              eq(jobs.projectId, projectId),
              eq(jobs.id, jobId),
              eq(jobs.version, version),
              inArray(jobs.state, MANUAL_DELIVERY_STATES),
              isNull(jobs.wordpressPostId),
              isNull(jobs.publishedUrl),
              sql`not exists(select 1 from ${images} where ${images.projectId} = ${projectId} and ${images.jobId} = ${jobId} and ${images.artifactVersion} = ${version} and ${images.status} = 'generating')`,
            ),
          )
          .returning({ id: jobs.id })
      ).length === 1
    );
  },
};
