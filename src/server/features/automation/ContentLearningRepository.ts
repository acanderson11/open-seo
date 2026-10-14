import { and, eq, desc, asc, sql, isNull } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  articleFeedback,
  articlePassageComments,
  articleRevisions,
  contentGuidelines,
  guidelineEvents,
  automationJobs,
  automationPolicies,
  projects,
} from "@/db/schema";
export const ContentLearningRepository = {
  async guidelines(projectId: string) {
    return db
      .select({ rule: contentGuidelines, feedback: articleFeedback })
      .from(contentGuidelines)
      .innerJoin(articleFeedback, eq(articleFeedback.id, contentGuidelines.id))
      .where(eq(contentGuidelines.projectId, projectId))
      .orderBy(asc(contentGuidelines.createdAt))
      .limit(101);
  },
  async active(projectId: string) {
    return db
      .select()
      .from(contentGuidelines)
      .where(
        and(
          eq(contentGuidelines.projectId, projectId),
          eq(contentGuidelines.status, "active"),
        ),
      )
      .orderBy(asc(contentGuidelines.id))
      .limit(31);
  },
  async history(projectId: string, jobId: string) {
    const passages = await db
      .select({
        id: articlePassageComments.id,
        feedbackId: articlePassageComments.feedbackId,
        blockIndex: articlePassageComments.blockIndex,
        quote: articlePassageComments.quote,
        message: articlePassageComments.message,
      })
      .from(articlePassageComments)
      .innerJoin(
        articleFeedback,
        eq(articlePassageComments.feedbackId, articleFeedback.id),
      )
      .where(
        and(
          eq(articleFeedback.projectId, projectId),
          eq(articleFeedback.jobId, jobId),
        ),
      )
      .orderBy(asc(articlePassageComments.blockIndex));
    return {
      feedback: (
        await db
          .select()
          .from(articleFeedback)
          .where(
            and(
              eq(articleFeedback.projectId, projectId),
              eq(articleFeedback.jobId, jobId),
            ),
          )
          .orderBy(desc(articleFeedback.artifactVersion))
      ).map((item) => ({
        ...item,
        passages: passages.filter((p) => p.feedbackId === item.id),
      })),
      revisions: await db
        .select()
        .from(articleRevisions)
        .where(
          and(
            eq(articleRevisions.projectId, projectId),
            eq(articleRevisions.jobId, jobId),
          ),
        )
        .orderBy(desc(articleRevisions.artifactVersion)),
    };
  },
  async setStatus(
    projectId: string,
    id: string,
    version: number,
    status: string,
    actorId: string,
  ) {
    const eventId = crypto.randomUUID();
    await runBatch((tx) => [
      tx
        .insert(guidelineEvents)
        .select(
          tx
            .select({
              id: sql`${eventId}`.as("id"),
              guidelineId: contentGuidelines.id,
              version: sql`${version + 1}`.as("version"),
              status: sql`${status}`.as("status"),
              actorId: sql`${actorId}`.as("actorId"),
              createdAt: sql`${new Date().toISOString()}`.as("createdAt"),
            })
            .from(contentGuidelines)
            .where(
              and(
                eq(contentGuidelines.projectId, projectId),
                eq(contentGuidelines.id, id),
                eq(contentGuidelines.version, version),
                status === "active"
                  ? sql`exists(select 1 from ${articleFeedback} where ${articleFeedback.id} = ${contentGuidelines.id} and ${articleFeedback.scope} = 'preference')`
                  : undefined,
              ),
            ),
        )
        .onConflictDoNothing(),
      tx
        .update(contentGuidelines)
        .set({ status, version: version + 1 })
        .where(
          and(
            eq(contentGuidelines.projectId, projectId),
            eq(contentGuidelines.id, id),
            eq(contentGuidelines.version, version),
            sql`exists(select 1 from ${guidelineEvents} where ${guidelineEvents.id}=${eventId})`,
          ),
        ),
    ]);
    return (
      (
        await db
          .select()
          .from(guidelineEvents)
          .where(eq(guidelineEvents.id, eventId))
      ).length === 1
    );
  },
  async queued() {
    return db
      .select({
        id: automationJobs.id,
        projectId: automationJobs.projectId,
        version: automationJobs.version,
        revisionRequest: sql<string>`coalesce((select ${articleFeedback.editToken} from ${articleFeedback} where ${articleFeedback.jobId} = ${automationJobs.id} and ${articleFeedback.projectId} = ${automationJobs.projectId} and ${articleFeedback.artifactVersion} = ${automationJobs.version} order by ${articleFeedback.createdAt} desc limit 1), 'initial')`,
      })
      .from(automationJobs)
      .innerJoin(
        automationPolicies,
        eq(automationPolicies.projectId, automationJobs.projectId),
      )
      .innerJoin(projects, eq(projects.id, automationJobs.projectId))
      .where(
        and(
          eq(automationJobs.state, "revision_queued"),
          eq(automationPolicies.enabled, 1),
          isNull(automationPolicies.busyJobId),
          isNull(projects.archivedAt),
        ),
      )
      .limit(25);
  },
  async claim(projectId: string, id: string, version: number) {
    return (
      (
        await db
          .update(automationJobs)
          .set({
            state: "revising",
            qualityPassed: 0,
            notificationState: null,
            message: null,
          })
          .where(
            and(
              eq(automationJobs.projectId, projectId),
              eq(automationJobs.id, id),
              eq(automationJobs.version, version),
              eq(automationJobs.state, "revision_queued"),
            ),
          )
          .returning()
      ).length === 1
    );
  },
};
