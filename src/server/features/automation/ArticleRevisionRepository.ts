import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { automationJobs, articleFeaturedImages } from "@/db/schema";

const jobScope = (projectId: string, id: string) =>
  and(eq(automationJobs.projectId, projectId), eq(automationJobs.id, id));

/** Writes the outcome of a revision run onto the job it revised. */
export const ArticleRevisionRepository = {
  async completeRevision(
    projectId: string,
    id: string,
    version: number,
    selectedImageId: string | null,
    input: Partial<typeof automationJobs.$inferInsert>,
  ) {
    const nextImageId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const now = new Date().toISOString();
    const selectedMatches = selectedImageId
      ? eq(automationJobs.featuredImageId, selectedImageId)
      : isNull(automationJobs.featuredImageId);
    const currentJob = and(
      jobScope(projectId, id),
      eq(automationJobs.version, version),
      eq(automationJobs.state, "revising"),
      selectedMatches,
      isNull(automationJobs.notificationState),
      isNull(automationJobs.wordpressPostId),
      isNull(automationJobs.publishedUrl),
    );
    await runBatch((tx) => [
      tx
        .insert(articleFeaturedImages)
        .select(
          tx
            .select({
              id: sql`${nextImageId}`.as("id"),
              projectId: articleFeaturedImages.projectId,
              jobId: articleFeaturedImages.jobId,
              artifactVersion: sql`${version + 1}`.as("artifactVersion"),
              status: articleFeaturedImages.status,
              source: articleFeaturedImages.source,
              r2Key: articleFeaturedImages.r2Key,
              sourceAssetId: articleFeaturedImages.sourceAssetId,
              sourceUrl: articleFeaturedImages.sourceUrl,
              rightsNote: articleFeaturedImages.rightsNote,
              model: articleFeaturedImages.model,
              prompt: articleFeaturedImages.prompt,
              visualBrief: articleFeaturedImages.visualBrief,
              altText: articleFeaturedImages.altText,
              bytes: articleFeaturedImages.bytes,
              failure: sql`null`.as("failure"),
              costUsd: sql`null`.as("costUsd"),
              wordpressMediaId: articleFeaturedImages.wordpressMediaId,
              actorId: sql`'system:image'`.as("actorId"),
              createdAt: sql`${now}`.as("createdAt"),
            })
            .from(articleFeaturedImages)
            .where(
              and(
                eq(articleFeaturedImages.projectId, projectId),
                eq(articleFeaturedImages.jobId, id),
                eq(articleFeaturedImages.id, selectedImageId ?? ""),
                eq(articleFeaturedImages.artifactVersion, version),
                eq(articleFeaturedImages.status, "ready"),
                sql`${articleFeaturedImages.r2Key} is not null`,
                sql`exists (select 1 from ${automationJobs} where ${currentJob})`,
              ),
            ),
        )
        .onConflictDoNothing(),
      tx
        .update(automationJobs)
        .set({
          ...input,
          notificationState: token,
          featuredImageId: sql`case when exists (select 1 from ${articleFeaturedImages} where ${articleFeaturedImages.id} = ${nextImageId} and ${articleFeaturedImages.projectId} = ${projectId} and ${articleFeaturedImages.jobId} = ${id} and ${articleFeaturedImages.artifactVersion} = ${version + 1} and ${articleFeaturedImages.status} = 'ready') then ${nextImageId} else null end`,
        })
        .where(currentJob),
    ]);
    const [updated] = await db
      .select({ notificationState: automationJobs.notificationState })
      .from(automationJobs)
      .where(jobScope(projectId, id));
    if (updated?.notificationState !== token) return false;
    await db
      .update(automationJobs)
      .set({ notificationState: null })
      .where(
        and(
          jobScope(projectId, id),
          eq(automationJobs.notificationState, token),
        ),
      );
    return true;
  },
  async failRevision(
    projectId: string,
    id: string,
    version: number,
    state: "outcome_unknown" | "needs_revision",
    message: string,
  ) {
    return (
      (
        await db
          .update(automationJobs)
          .set({ state, message })
          .where(
            and(
              jobScope(projectId, id),
              eq(automationJobs.version, version),
              eq(automationJobs.state, "revising"),
            ),
          )
          .returning({ id: automationJobs.id })
      ).length === 1
    );
  },
};
