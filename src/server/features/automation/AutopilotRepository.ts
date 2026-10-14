import { and, eq, sql, isNull, gte } from "drizzle-orm";
import { db } from "@/db";
import {
  automationPolicies,
  automationJobs,
  articleFeaturedImages,
  automationRuns,
  wordpressConnections,
  automationReviewLinks,
  projects,
} from "@/db/schema";
export const AutopilotRepository = {
  async projects() {
    return db
      .select({ id: projects.id, domain: projects.domain })
      .from(projects)
      .innerJoin(
        automationPolicies,
        eq(projects.id, automationPolicies.projectId),
      )
      .where(
        and(
          eq(automationPolicies.enabled, 1),
          eq(automationPolicies.autopilot, 1),
          isNull(projects.archivedAt),
        ),
      )
      .limit(100);
  },
  async stats(projectId: string, period: string) {
    const [attempts, completed] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)` })
        .from(automationRuns)
        .where(
          and(
            eq(automationRuns.projectId, projectId),
            gte(automationRuns.day, period + "-01"),
            sql`${automationRuns.day} < ${period + "-32"}`,
          ),
        ),
      db
        .select({ n: sql<number>`count(*)` })
        .from(automationJobs)
        .where(
          and(
            eq(automationJobs.projectId, projectId),
            gte(automationJobs.createdAt, period + "-01"),
            eq(automationJobs.kind, "new_content"),
            eq(automationJobs.qualityPassed, 1),
          ),
        ),
    ]);
    return {
      attempts: Number(attempts[0]?.n ?? 0),
      completed: Number(completed[0]?.n ?? 0),
    };
  },
  async reserveRun(projectId: string, day: string) {
    const id = crypto.randomUUID();
    return (
      (
        await db
          .insert(automationRuns)
          .values({
            id,
            projectId,
            day,
            state: "reserved",
            createdAt: new Date().toISOString(),
          })
          .onConflictDoNothing()
          .returning()
      )[0] ?? null
    );
  },
  async run(id: string) {
    return (
      (
        await db.select().from(automationRuns).where(eq(automationRuns.id, id))
      )[0] ?? null
    );
  },
  async claimRun(id: string) {
    return (
      (
        await db
          .update(automationRuns)
          .set({ state: "running" })
          .where(
            and(
              eq(automationRuns.id, id),
              eq(automationRuns.state, "reserved"),
            ),
          )
          .returning()
      ).length === 1
    );
  },
  async finishRun(id: string, state: string, message: string) {
    await db
      .update(automationRuns)
      .set({ state, message })
      .where(eq(automationRuns.id, id));
  },
  async status(projectId: string, message: string) {
    await db
      .update(automationPolicies)
      .set({ lastPlanStatus: message })
      .where(eq(automationPolicies.projectId, projectId));
  },
  async wordpress(projectId: string) {
    return (
      (
        await db
          .select()
          .from(wordpressConnections)
          .where(eq(wordpressConnections.projectId, projectId))
      )[0] ?? null
    );
  },
  async saveWordpress(values: typeof wordpressConnections.$inferInsert) {
    await db.insert(wordpressConnections).values(values).onConflictDoUpdate({
      target: wordpressConnections.projectId,
      set: values,
    });
  },
  async recentTopics(projectId: string) {
    return db
      .select({
        topic: automationJobs.topic,
        targetUrl: automationJobs.targetUrl,
      })
      .from(automationJobs)
      .where(eq(automationJobs.projectId, projectId))
      .limit(500);
  },
  async pendingPublication() {
    return db
      .select({ projectId: automationJobs.projectId, id: automationJobs.id })
      .from(automationJobs)
      .where(
        and(
          eq(automationJobs.state, "ready_for_manual_publication"),
          sql`not exists(select 1 from ${articleFeaturedImages} where ${articleFeaturedImages.projectId} = ${automationJobs.projectId} and ${articleFeaturedImages.jobId} = ${automationJobs.id} and ${articleFeaturedImages.artifactVersion} = ${automationJobs.version} and ${articleFeaturedImages.status} = 'generating')`,
          eq(automationJobs.kind, "new_content"),
          sql`${automationJobs.wordpressVersion} is not null`,
          sql`exists(select 1 from ${automationPolicies} where ${automationPolicies.projectId} = ${automationJobs.projectId} and ${automationPolicies.delivery} = 'wordpress' and ${automationPolicies.enabled} = 1 and ${automationPolicies.autopilot} = 1 and ${automationPolicies.version} = ${automationJobs.policyVersion})`,
        ),
      )
      .limit(10);
  },
  async claimPublication(projectId: string, id: string) {
    return (
      (
        await db
          .update(automationJobs)
          .set({ state: "publishing" })
          .where(
            and(
              eq(automationJobs.id, id),
              eq(automationJobs.projectId, projectId),
              eq(automationJobs.state, "ready_for_manual_publication"),
              sql`not exists(select 1 from ${articleFeaturedImages} where ${articleFeaturedImages.projectId} = ${automationJobs.projectId} and ${articleFeaturedImages.jobId} = ${automationJobs.id} and ${articleFeaturedImages.artifactVersion} = ${automationJobs.version} and ${articleFeaturedImages.status} = 'generating')`,
              eq(automationJobs.kind, "new_content"),
              sql`${automationJobs.wordpressVersion} is not null`,
              sql`exists(select 1 from ${automationPolicies} where ${automationPolicies.projectId} = ${automationJobs.projectId} and ${automationPolicies.delivery} = 'wordpress' and ${automationPolicies.enabled} = 1 and ${automationPolicies.autopilot} = 1 and ${automationPolicies.version} = ${automationJobs.policyVersion})`,
            ),
          )
          .returning()
      ).length === 1
    );
  },
  async claimNotification(projectId: string, id: string) {
    return (
      (
        await db
          .update(automationJobs)
          .set({ notificationState: "sending" })
          .where(
            and(
              eq(automationJobs.id, id),
              eq(automationJobs.projectId, projectId),
              eq(automationJobs.state, "awaiting_approval"),
              isNull(automationJobs.notificationState),
            ),
          )
          .returning()
      ).length === 1
    );
  },
  async saveLink(values: typeof automationReviewLinks.$inferInsert) {
    await db.insert(automationReviewLinks).values(values);
  },
  async link(tokenHash: string) {
    return (
      (
        await db
          .select()
          .from(automationReviewLinks)
          .where(eq(automationReviewLinks.tokenHash, tokenHash))
      )[0] ?? null
    );
  },
  async useLink(tokenHash: string) {
    await db
      .update(automationReviewLinks)
      .set({ usedAt: new Date().toISOString() })
      .where(eq(automationReviewLinks.tokenHash, tokenHash));
  },
};
