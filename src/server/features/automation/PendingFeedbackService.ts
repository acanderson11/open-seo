import { AutomationRepository } from "./AutomationRepository";
import { PendingFeedbackRepository } from "./PendingFeedbackRepository";
import {
  validateFeedback,
  type ContentFeedback,
} from "@/types/schemas/contentFeedback";
import { AppError } from "@/server/lib/errors";
export async function savePendingFeedback(
  projectId: string,
  input: {
    jobId: string;
    version: number;
    feedbackId: string;
    expectedToken: string | null;
    feedback: ContentFeedback;
    queueRevision?: boolean;
  },
) {
  const job = await AutomationRepository.job(projectId, input.jobId);
  const policy = await AutomationRepository.policy(projectId);
  if (!job || !policy) throw new AppError("NOT_FOUND");
  if (policy.approval !== "agency") throw new AppError("FORBIDDEN");
  if (
    job.version !== input.version ||
    job.state !== "needs_revision" ||
    !job.bodyHtml
  )
    throw new AppError("CONFLICT");
  if (
    input.queueRevision &&
    (!policy.enabled ||
      input.version >= 4 ||
      policy.version !== job.policyVersion)
  )
    throw new AppError("CONFLICT");
  const feedback = validateFeedback(
    "changes_requested",
    { ...input.feedback, scope: "article", instruction: "" },
    job.bodyHtml,
  );
  if (
    !(await PendingFeedbackRepository.save(
      projectId,
      job.id,
      input.version,
      input.feedbackId,
      {
        expectedToken: input.expectedToken,
        feedback,
        queueRevision: input.queueRevision,
      },
    ))
  )
    throw new AppError("CONFLICT");
  return { saved: true, queued: !!input.queueRevision };
}
