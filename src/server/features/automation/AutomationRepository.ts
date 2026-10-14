import type { ContentFeedback } from "@/types/schemas/contentFeedback";
import { MAX_ARTICLE_VERSION } from "@/types/schemas/automation";
import { runBatch } from "@/db/runBatch";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  automationPolicies,
  automationJobs,
  automationApprovals,
  articleFeaturedImages,
  articleFeedback,
  articlePassageComments,
  articleRevisions,
  contentGuidelines,
} from "@/db/schema";
const jobScope = (projectId: string, id: string) =>
  and(eq(automationJobs.projectId, projectId), eq(automationJobs.id, id));
export const AutomationRepository = {
  async policy(projectId: string) {
    return (
      (
        await db
          .select()
          .from(automationPolicies)
          .where(eq(automationPolicies.projectId, projectId))
      )[0] ?? null
    );
  },
  async savePolicy(
    projectId: string,
    input: {
      enabled: boolean;
      delivery?: "manual" | "wordpress";
      monthlyLimit: number;
      approval: string;
      expectedVersion: string | null;
      autopilot?: boolean;
      monthlyTarget?: number;
      reviewerEmail?: string;
    },
  ) {
    const values = {
      enabled: input.enabled ? 1 : 0,
      delivery: input.delivery ?? "manual",
      autopilot: input.autopilot ? 1 : 0,
      monthlyTarget: input.monthlyTarget ?? 4,
      reviewerEmail: input.reviewerEmail ?? null,
      monthlyLimit: input.monthlyLimit,
      approval: input.approval,
      version: crypto.randomUUID(),
    };
    if (input.expectedVersion === null)
      return (
        (
          await db
            .insert(automationPolicies)
            .values({
              projectId,
              ...values,
              used: 0,
              period: "",
              busyJobId: null,
            })
            .onConflictDoNothing()
            .returning()
        ).length === 1
      );
    return (
      (
        await db
          .update(automationPolicies)
          .set(values)
          .where(
            and(
              eq(automationPolicies.projectId, projectId),
              eq(automationPolicies.version, input.expectedVersion),
            ),
          )
          .returning()
      ).length === 1
    );
  },
  async jobs(projectId: string) {
    return db
      .select({
        id: automationJobs.id,
        topic: automationJobs.topic,
        priority: automationJobs.priority,
        state: automationJobs.state,
        message: automationJobs.message,
        rationale: automationJobs.rationale,
        publishedUrl: automationJobs.publishedUrl,
        createdAt: automationJobs.createdAt,
      })
      .from(automationJobs)
      .where(eq(automationJobs.projectId, projectId))
      .orderBy(desc(automationJobs.createdAt))
      .limit(50);
  },
  async job(projectId: string, id: string) {
    return (
      (
        await db.select().from(automationJobs).where(jobScope(projectId, id))
      )[0] ?? null
    );
  },
  async byRequest(projectId: string, requestKey: string) {
    return (
      (
        await db
          .select()
          .from(automationJobs)
          .where(
            and(
              eq(automationJobs.projectId, projectId),
              eq(automationJobs.requestKey, requestKey),
            ),
          )
      )[0] ?? null
    );
  },
  async create(input: typeof automationJobs.$inferInsert) {
    return (
      (
        await db
          .insert(automationJobs)
          .values(input)
          .onConflictDoNothing()
          .returning()
      ).length === 1
    );
  },
  async reserve(
    projectId: string,
    jobId: string,
    version: string,
    period: string,
  ) {
    // Single-row UPDATE serializes competing reservations on both D1 and PG.
    // Unknown outcomes retain the slot; never automatically repeat a paid run.
    return (
      (
        await db
          .update(automationPolicies)
          .set({
            busyJobId: jobId,
            period,
            used: sql`case when ${automationPolicies.period} = ${period} then ${automationPolicies.used} + 1 else 1 end`,
          })
          .where(
            and(
              eq(automationPolicies.projectId, projectId),
              eq(automationPolicies.version, version),
              eq(automationPolicies.enabled, 1),
              isNull(automationPolicies.busyJobId),
              or(
                sql`${automationPolicies.period} <> ${period}`,
                sql`${automationPolicies.used} < ${automationPolicies.monthlyLimit}`,
              ),
            ),
          )
          .returning()
      ).length === 1
    );
  },
  async update(
    projectId: string,
    id: string,
    input: Partial<typeof automationJobs.$inferInsert>,
  ) {
    await db.update(automationJobs).set(input).where(jobScope(projectId, id));
  },
  async releaseSlot(projectId: string, jobId: string, refundUnused = false) {
    await db
      .update(automationPolicies)
      .set({
        busyJobId: null,
        used: refundUnused
          ? sql`case when ${automationPolicies.used} > 0 then ${automationPolicies.used} - 1 else 0 end`
          : automationPolicies.used,
      })
      .where(
        and(
          eq(automationPolicies.projectId, projectId),
          eq(automationPolicies.busyJobId, jobId),
        ),
      );
  },
  async approve(
    projectId: string,
    jobId: string,
    actorId: string,
    decision: string,
    transition:
      | string
      | {
          state: string;
          role?: "agency" | "client";
          artifactVersion?: number;
          featuredImageId?: string | null;
          feedback?: ContentFeedback;
          wordpressVersion?: string | null;
        } = "awaiting_approval",
  ) {
    const artifactVersion =
      typeof transition === "string" ? 1 : (transition.artifactVersion ?? 1);
    const feedback =
      typeof transition === "string" ? undefined : transition.feedback;
    const nextState =
      typeof transition === "string" ? transition : transition.state;
    const role =
      typeof transition === "string" ? "agency" : (transition.role ?? "agency");
    const wordpressVersion =
      typeof transition === "string" ? undefined : transition.wordpressVersion;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const won = sql`exists (select 1 from ${automationApprovals} where ${automationApprovals.id} = ${id})`;
    await runBatch((tx) => [
      tx
        .insert(automationApprovals)
        .select(
          tx
            .select({
              id: sql`${id}`.as("id"),
              projectId: automationJobs.projectId,
              jobId: automationJobs.id,
              artifactVersion: automationJobs.version,
              role: sql`${role}`.as("role"),
              actorId: sql`${actorId}`.as("actorId"),
              decision: sql`${decision}`.as("decision"),
              featuredImageId: automationJobs.featuredImageId,
              revokedAt: sql`null`.as("revokedAt"),
              revokedBy: sql`null`.as("revokedBy"),
              createdAt: sql`${now}`.as("createdAt"),
            })
            .from(automationJobs)
            .where(
              and(
                jobScope(projectId, jobId),
                eq(automationJobs.version, artifactVersion),
                ...(typeof transition === "string" ||
                transition.featuredImageId === undefined
                  ? []
                  : [
                      transition.featuredImageId === null
                        ? isNull(automationJobs.featuredImageId)
                        : eq(
                            automationJobs.featuredImageId,
                            transition.featuredImageId,
                          ),
                    ]),
                ...(decision === "approved"
                  ? [
                      sql`not exists(select 1 from ${articleFeaturedImages} where ${articleFeaturedImages.projectId} = ${projectId} and ${articleFeaturedImages.jobId} = ${jobId} and ${articleFeaturedImages.artifactVersion} = ${artifactVersion} and ${articleFeaturedImages.status} = 'generating')`,
                    ]
                  : []),
                decision === "changes_requested"
                  ? or(
                      eq(automationJobs.state, "awaiting_approval"),
                      eq(automationJobs.state, "needs_revision"),
                    )
                  : eq(automationJobs.state, "awaiting_approval"),
              ),
            ),
        )
        .onConflictDoNothing(),
      tx
        .insert(articleRevisions)
        .select(
          tx
            .select({
              id: sql`${id}`.as("id"),
              projectId: automationJobs.projectId,
              jobId: automationJobs.id,
              artifactVersion: automationJobs.version,
              title: automationJobs.title,
              metaDescription: automationJobs.metaDescription,
              bodyHtml: automationJobs.bodyHtml,
              featuredImageId: automationJobs.featuredImageId,
              contextVersion: automationJobs.contextVersion,
              policyVersion: automationJobs.policyVersion,
              review: automationJobs.review,
              createdAt: sql`${now}`.as("createdAt"),
            })
            .from(automationJobs)
            .where(and(jobScope(projectId, jobId), won)),
        )
        .onConflictDoNothing(),
      ...(feedback?.message || feedback?.passages?.length
        ? [
            tx.insert(articleFeedback).select(
              tx
                .select({
                  id: automationApprovals.id,
                  projectId: automationApprovals.projectId,
                  jobId: automationApprovals.jobId,
                  artifactVersion: automationApprovals.artifactVersion,
                  message: sql`${feedback.message}`.as("message"),
                  scope: sql`${feedback.scope}`.as("scope"),
                  category: sql`${feedback.category}`.as("category"),
                  instruction: sql`${feedback.instruction}`.as("instruction"),
                  editToken: sql`null`.as("editToken"),
                  actorId: automationApprovals.actorId,
                  role: automationApprovals.role,
                  createdAt: automationApprovals.createdAt,
                })
                .from(automationApprovals)
                .where(eq(automationApprovals.id, id)),
            ),
          ]
        : []),
      ...((feedback?.message || feedback?.passages?.length) &&
      feedback.scope !== "article"
        ? [
            tx.insert(contentGuidelines).select(
              tx
                .select({
                  id: articleFeedback.id,
                  projectId: articleFeedback.projectId,
                  category: articleFeedback.category,
                  instruction: articleFeedback.instruction,
                  status:
                    sql`case when ${feedback.scope} = 'fact' or exists (select 1 from ${contentGuidelines} where ${contentGuidelines.projectId} = ${projectId} and ${contentGuidelines.category} = ${feedback.category} and ${contentGuidelines.status} = 'active') then 'proposed' else 'active' end`.as(
                      "status",
                    ),
                  version: sql`1`.as("version"),
                  createdAt: articleFeedback.createdAt,
                })
                .from(articleFeedback)
                .where(eq(articleFeedback.id, id)),
            ),
          ]
        : []),
      ...(feedback?.passages ?? []).map((passage) =>
        tx.insert(articlePassageComments).select(
          tx
            .select({
              id: sql`${crypto.randomUUID()}`.as("id"),
              feedbackId: articleFeedback.id,
              blockIndex: sql`${passage.blockIndex}`.as("blockIndex"),
              quote: sql`${passage.quote}`.as("quote"),
              message: sql`${passage.message}`.as("message"),
            })
            .from(articleFeedback)
            .where(eq(articleFeedback.id, id)),
        ),
      ),
      tx
        .update(automationJobs)
        .set({
          state: nextState,
          ...(wordpressVersion === undefined ? {} : { wordpressVersion }),
          message:
            decision === "changes_requested"
              ? artifactVersion >= MAX_ARTICLE_VERSION
                ? "Feedback saved. Three revisions reached; agency intervention required."
                : "Feedback saved. Revision queued for the next scheduler check (about five minutes), subject to the monthly allowance; approval is required again."
              : null,
        })
        .where(
          and(
            jobScope(projectId, jobId),
            eq(automationJobs.version, artifactVersion),
            won,
          ),
        ),
    ]);
    return (
      (
        await db
          .select({ id: automationApprovals.id })
          .from(automationApprovals)
          .where(eq(automationApprovals.id, id))
      ).length === 1
    );
  },
};
