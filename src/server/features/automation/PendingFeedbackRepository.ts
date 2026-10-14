import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  articleFeedback,
  articlePassageComments,
  automationJobs,
} from "@/db/schema";
import type { ContentFeedback } from "@/types/schemas/contentFeedback";
export const PendingFeedbackRepository = {
  async save(
    projectId: string,
    jobId: string,
    version: number,
    feedbackId: string,
    input: {
      expectedToken: string | null;
      feedback: ContentFeedback;
      queueRevision?: boolean;
    },
  ) {
    const { expectedToken, feedback } = input;
    const token = crypto.randomUUID();
    const won = sql`exists(select 1 from ${articleFeedback} where ${articleFeedback.id} = ${feedbackId} and ${articleFeedback.editToken} = ${token})`;
    await runBatch((tx) => [
      tx
        .update(articleFeedback)
        .set({ message: feedback.message, editToken: token })
        .where(
          and(
            eq(articleFeedback.id, feedbackId),
            eq(articleFeedback.projectId, projectId),
            eq(articleFeedback.jobId, jobId),
            eq(articleFeedback.artifactVersion, version),
            eq(articleFeedback.role, "agency"),
            expectedToken === null
              ? isNull(articleFeedback.editToken)
              : eq(articleFeedback.editToken, expectedToken),
            sql`exists(select 1 from ${automationJobs} where ${automationJobs.id} = ${jobId} and ${automationJobs.projectId} = ${projectId} and ${automationJobs.version} = ${version} and ${automationJobs.state} = 'needs_revision')`,
          ),
        ),
      tx
        .delete(articlePassageComments)
        .where(and(eq(articlePassageComments.feedbackId, feedbackId), won)),
      ...(feedback.passages ?? []).map((p) =>
        tx.insert(articlePassageComments).select(
          tx
            .select({
              id: sql`${crypto.randomUUID()}`.as("id"),
              feedbackId: articleFeedback.id,
              blockIndex: sql`${p.blockIndex}`.as("blockIndex"),
              quote: sql`${p.quote}`.as("quote"),
              message: sql`${p.message}`.as("message"),
            })
            .from(articleFeedback)
            .where(
              and(
                eq(articleFeedback.id, feedbackId),
                eq(articleFeedback.editToken, token),
              ),
            ),
        ),
      ),
      ...(input.queueRevision
        ? [
            tx
              .update(automationJobs)
              .set({
                state: "revision_queued",
                message:
                  "Feedback saved. Revision queued; optional research questions do not need to be answered.",
              })
              .where(
                and(
                  eq(automationJobs.projectId, projectId),
                  eq(automationJobs.id, jobId),
                  eq(automationJobs.version, version),
                  eq(automationJobs.state, "needs_revision"),
                  won,
                ),
              ),
          ]
        : []),
    ]);
    return (
      (
        await db
          .select({ id: articleFeedback.id })
          .from(articleFeedback)
          .where(
            and(
              eq(articleFeedback.id, feedbackId),
              eq(articleFeedback.editToken, token),
            ),
          )
      ).length === 1
    );
  },
};
