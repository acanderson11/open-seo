import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  articleFeaturedImages as images,
  automationJobs as jobs,
  automationApprovals as approvals,
  automationReviewLinks as links,
} from "@/db/schema";

const scope = (projectId: string, jobId: string) =>
  and(eq(jobs.projectId, projectId), eq(jobs.id, jobId));

/** One version of one article in a project. */
export type ArticleVersion = {
  projectId: string;
  jobId: string;
  version: number;
};

export const FeaturedImageRepository = {
  async image(projectId: string, id: string) {
    return (
      (
        await db
          .select()
          .from(images)
          .where(and(eq(images.projectId, projectId), eq(images.id, id)))
      )[0] ?? null
    );
  },
  async cloneReadyForVersion(
    projectId: string,
    jobId: string,
    sourceImageId: string,
    version: number,
    actorId: string,
  ) {
    const source = await this.image(projectId, sourceImageId);
    if (
      !source ||
      source.jobId !== jobId ||
      source.artifactVersion >= version ||
      source.status !== "ready" ||
      !source.r2Key
    )
      return null;
    const id = crypto.randomUUID();
    const inserted = await this.begin({
      id,
      projectId,
      jobId,
      artifactVersion: version,
      status: "ready",
      source: source.source,
      r2Key: source.r2Key,
      sourceAssetId: source.sourceAssetId,
      sourceUrl: source.sourceUrl,
      rightsNote: source.rightsNote,
      model: source.model,
      prompt: source.prompt,
      visualBrief: source.visualBrief,
      altText: source.altText,
      bytes: source.bytes,
      costUsd: null,
      wordpressMediaId: source.wordpressMediaId,
      actorId,
      createdAt: new Date().toISOString(),
    });
    return inserted ? id : null;
  },
  async selected(projectId: string, jobId: string) {
    const job = (
      await db
        .select({ id: jobs.featuredImageId })
        .from(jobs)
        .where(scope(projectId, jobId))
    )[0];
    return job?.id ? this.image(projectId, job.id) : null;
  },
  async previousReady(projectId: string, jobId: string, version: number) {
    return db
      .select()
      .from(images)
      .where(
        and(
          eq(images.projectId, projectId),
          eq(images.jobId, jobId),
          lt(images.artifactVersion, version),
          eq(images.status, "ready"),
          isNotNull(images.r2Key),
        ),
      )
      .orderBy(desc(images.artifactVersion), desc(images.createdAt))
      .limit(10);
  },
  async attempts(projectId: string, jobId: string, version: number) {
    return db
      .select()
      .from(images)
      .where(
        and(
          eq(images.projectId, projectId),
          eq(images.jobId, jobId),
          eq(images.artifactVersion, version),
        ),
      )
      .orderBy(desc(images.createdAt))
      .limit(20);
  },
  async begin(input: typeof images.$inferInsert) {
    return (
      (
        await db
          .insert(images)
          .values(input)
          .onConflictDoNothing()
          .returning({ id: images.id })
      ).length === 1
    );
  },
  async finish(
    projectId: string,
    id: string,
    input: Partial<typeof images.$inferInsert>,
  ) {
    return (
      (
        await db
          .update(images)
          .set({ ...input, status: "ready" })
          .where(
            and(
              eq(images.projectId, projectId),
              eq(images.id, id),
              eq(images.status, "generating"),
            ),
          )
          .returning()
      ).length === 1
    );
  },
  async recordProviderResult(
    projectId: string,
    id: string,
    model: string,
    costUsd: string | null,
  ) {
    return (
      (
        await db
          .update(images)
          .set({ model, costUsd })
          .where(
            and(
              eq(images.projectId, projectId),
              eq(images.id, id),
              eq(images.status, "generating"),
            ),
          )
          .returning({ id: images.id })
      ).length === 1
    );
  },
  async fail(projectId: string, id: string, reason: string) {
    await db
      .update(images)
      .set({ status: "failed", failure: reason.slice(0, 300) })
      .where(
        and(
          eq(images.projectId, projectId),
          eq(images.id, id),
          or(
            eq(images.status, "generating"),
            and(
              eq(images.status, "ready"),
              sql`not exists(select 1 from ${jobs} where ${jobs.id} = ${images.jobId} and ${jobs.projectId} = ${projectId} and ${jobs.featuredImageId} = ${images.id})`,
            ),
          ),
        ),
      );
  },
  async abandon(projectId: string, jobId: string, version: number, id: string) {
    const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
    return (
      (
        await db
          .update(images)
          .set({
            status: "failed",
            failure:
              "Outcome uncertain; agency marked the stalled attempt unresolved.",
          })
          .where(
            and(
              eq(images.projectId, projectId),
              eq(images.jobId, jobId),
              eq(images.artifactVersion, version),
              eq(images.id, id),
              eq(images.status, "generating"),
              sql`${images.createdAt} < ${cutoff}`,
            ),
          )
          .returning()
      ).length === 1
    );
  },
  async setWordpressMedia(projectId: string, id: string, mediaId: number) {
    return (
      (
        await db
          .update(images)
          .set({ wordpressMediaId: mediaId })
          .where(
            and(
              eq(images.projectId, projectId),
              eq(images.id, id),
              isNull(images.wordpressMediaId),
            ),
          )
          .returning()
      ).length === 1
    );
  },
  async select(
    { projectId, jobId, version }: ArticleVersion,
    imageId: string,
    actorId: string,
    altText?: string,
  ) {
    const token = crypto.randomUUID();
    const now = new Date().toISOString();
    const won = sql`exists(select 1 from ${jobs} where ${jobs.projectId} = ${projectId} and ${jobs.id} = ${jobId} and ${jobs.notificationState} = ${token})`;
    await runBatch((tx) => [
      tx
        .update(jobs)
        .set({
          featuredImageId: imageId,
          state: sql`case when ${jobs.state} in ('ready_for_manual_publication', 'ready_to_publish', 'publication_blocked') then 'awaiting_approval' else ${jobs.state} end`,
          notificationState: token,
          message:
            "Featured image changed. Review the article and image together before approval.",
        })
        .where(
          and(
            scope(projectId, jobId),
            eq(jobs.version, version),
            inArray(jobs.state, [
              "awaiting_approval",
              "needs_revision",
              "ready_for_manual_publication",
              "ready_to_publish",
              "publication_blocked",
            ]),
            isNull(jobs.wordpressPostId),
            isNull(jobs.publishedUrl),
            or(
              isNull(jobs.notificationState),
              ne(jobs.notificationState, "sending"),
            ),
            sql`exists(select 1 from ${images} where ${images.id} = ${imageId} and ${images.projectId} = ${projectId} and ${images.jobId} = ${jobId} and ${images.artifactVersion} = ${version} and ${images.status} = 'ready')`,
            sql`not exists(select 1 from ${images} where ${images.projectId} = ${projectId} and ${images.jobId} = ${jobId} and ${images.artifactVersion} = ${version} and ${images.status} = 'generating')`,
          ),
        ),
      ...(altText === undefined
        ? []
        : [
            tx
              .update(images)
              .set({ altText })
              .where(
                and(
                  eq(images.id, imageId),
                  eq(images.projectId, projectId),
                  won,
                ),
              ),
          ]),
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
    const changed =
      (
        await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(scope(projectId, jobId), eq(jobs.notificationState, token)),
          )
      ).length === 1;
    if (changed)
      await db
        .update(jobs)
        .set({ notificationState: null })
        .where(and(scope(projectId, jobId), eq(jobs.notificationState, token)));
    return changed;
  },
};
