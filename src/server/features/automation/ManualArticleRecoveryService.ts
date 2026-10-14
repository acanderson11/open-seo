import { AppError } from "@/server/lib/errors";
import { AutomationRepository } from "./AutomationRepository";
import { contextSnapshot } from "./AutomationService";
import { sanitizeManualArticleHtml } from "./ManualArticleHtml";
import { recoverManualArticle } from "./ManualArticleRecoveryRepository";

export async function recoverUnknownArticle(
  projectId: string,
  actorId: string,
  input: {
    jobId: string;
    version: number;
    title: string;
    metaDescription: string;
    bodyHtml: string;
    executionsStopped: true;
    contentAndSourcesChecked: true;
  },
) {
  // Acknowledgment describes an agency check of the execution system. The app
  // cannot itself prove an external n8n workflow has stopped.
  if (!input.executionsStopped || !input.contentAndSourcesChecked)
    throw new AppError("VALIDATION_ERROR");
  const bodyHtml = sanitizeManualArticleHtml(input.bodyHtml);
  const [job, policy, current] = await Promise.all([
    AutomationRepository.job(projectId, input.jobId),
    AutomationRepository.policy(projectId),
    contextSnapshot(projectId),
  ]);
  if (!job || !policy) throw new AppError("NOT_FOUND");
  if (
    job.version !== input.version ||
    job.state !== "outcome_unknown" ||
    !job.bodyHtml ||
    !policy.enabled ||
    policy.approval !== "agency" ||
    policy.version !== job.policyVersion ||
    policy.busyJobId !== job.id ||
    current.version !== job.contextVersion
  )
    throw new AppError("CONFLICT");
  if (
    !(await recoverManualArticle({
      projectId,
      jobId: input.jobId,
      version: input.version,
      actorId,
      contextVersion: current.version,
      policyVersion: policy.version,
      priorExecutionId: job.n8nExecutionId,
      title: input.title.trim(),
      metaDescription: input.metaDescription.trim(),
      bodyHtml,
    }))
  )
    throw new AppError("CONFLICT");
  return AutomationRepository.job(projectId, input.jobId);
}
