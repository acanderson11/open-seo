import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  articleFeedback,
  articleRevisions,
  automationJobs,
  automationPolicies,
} from "@/db/schema";

type Recovery = {
  projectId: string;
  jobId: string;
  version: number;
  actorId: string;
  contextVersion: string;
  policyVersion: string;
  priorExecutionId: string | null;
  title: string;
  metaDescription: string;
  bodyHtml: string;
};

export async function recoverManualArticle(input: Recovery) {
  const nextVersion = input.version + 1;
  const recoveryId = crypto.randomUUID();
  const now = new Date().toISOString();
  const review = `Manual article recovery ${recoveryId} by agency actor ${input.actorId} at ${now}; previous n8n execution ${input.priorExecutionId ?? "unavailable"}. The automated revision outcome was unavailable. Content and sources were checked by the submitting actor; this is not an automated quality review. Prior draft and feedback remain in history.`;
  const message =
    "Manual replacement draft imported after an unknown automated revision outcome. Agency approval is still required. The uncertain generation attempt remains charged.";
  const jobScope = and(
    eq(automationJobs.projectId, input.projectId),
    eq(automationJobs.id, input.jobId),
  );
  const won = sql`exists (select 1 from ${automationJobs} where ${jobScope} and ${automationJobs.review} = ${review} and ${automationJobs.version} = ${nextVersion})`;
  await runBatch((tx) => [
    tx
      .update(automationJobs)
      .set({
        state: "awaiting_approval",
        version: nextVersion,
        title: input.title,
        metaDescription: input.metaDescription,
        bodyHtml: input.bodyHtml,
        featuredImageId: null,
        review,
        message,
        qualityPassed: 1,
        n8nExecutionId: null,
        completedAt: now,
      })
      .where(
        and(
          jobScope,
          eq(automationJobs.version, input.version),
          eq(automationJobs.state, "outcome_unknown"),
          eq(automationJobs.contextVersion, input.contextVersion),
          eq(automationJobs.policyVersion, input.policyVersion),
          sql`${automationJobs.bodyHtml} is not null`,
          sql`exists (select 1 from ${articleRevisions} where ${articleRevisions.projectId} = ${input.projectId} and ${articleRevisions.jobId} = ${input.jobId} and ${articleRevisions.artifactVersion} = ${input.version})`,
          sql`exists (select 1 from ${articleFeedback} where ${articleFeedback.projectId} = ${input.projectId} and ${articleFeedback.jobId} = ${input.jobId} and ${articleFeedback.artifactVersion} = ${input.version} and ${articleFeedback.role} = 'agency')`,
          sql`not exists (select 1 from ${articleRevisions} where ${articleRevisions.jobId} = ${input.jobId} and ${articleRevisions.artifactVersion} = ${nextVersion})`,
          sql`exists (select 1 from ${automationPolicies} where ${automationPolicies.projectId} = ${input.projectId} and ${automationPolicies.version} = ${input.policyVersion} and ${automationPolicies.enabled} = 1 and ${automationPolicies.approval} = 'agency' and ${automationPolicies.busyJobId} = ${input.jobId})`,
        ),
      ),
    tx.insert(articleRevisions).select(
      tx
        .select({
          id: sql`${recoveryId}`.as("id"),
          projectId: automationJobs.projectId,
          jobId: automationJobs.id,
          artifactVersion: automationJobs.version,
          title: automationJobs.title,
          metaDescription: automationJobs.metaDescription,
          bodyHtml: automationJobs.bodyHtml,
          contextVersion: automationJobs.contextVersion,
          policyVersion: automationJobs.policyVersion,
          review: automationJobs.review,
          createdAt: sql`${now}`.as("createdAt"),
        })
        .from(automationJobs)
        .where(and(jobScope, won)),
    ),
    tx
      .update(automationPolicies)
      .set({ busyJobId: null })
      .where(
        and(
          eq(automationPolicies.projectId, input.projectId),
          eq(automationPolicies.version, input.policyVersion),
          eq(automationPolicies.busyJobId, input.jobId),
          won,
        ),
      ),
  ]);
  return (
    (
      await db
        .select({ id: articleRevisions.id })
        .from(articleRevisions)
        .where(eq(articleRevisions.id, recoveryId))
    ).length === 1
  );
}
