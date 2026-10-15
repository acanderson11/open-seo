import { requestReview } from "./DraftReviewService";
import { ArticleLifecycleRepository as lifecycle } from "./ArticleLifecycleRepository";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { validateTarget } from "./AutomationService";
import { AppError } from "@/server/lib/errors";
export async function changeArticleLifecycle(
  projectId: string,
  actorId: string,
  input: {
    jobId: string;
    version: number;
    action: "reopen" | "published";
    publishedUrl?: string;
  },
) {
  let saved: boolean;
  if (input.action === "reopen")
    saved = await lifecycle.reopen(
      projectId,
      input.jobId,
      input.version,
      actorId,
    );
  else {
    const project = await ProjectRepository.getProjectById(projectId);
    if (!project?.domain || !input.publishedUrl)
      throw new AppError("VALIDATION_ERROR");
    const url = validateTarget(input.publishedUrl, project.domain);
    saved = await lifecycle.complete(
      projectId,
      input.jobId,
      input.version,
      url,
    );
  }
  if (!saved)
    throw new AppError(
      "CONFLICT",
      "Article changed or publication has already started. Refresh before continuing.",
    );
  // Reopening invalidates old links; send a fresh one where review is by link.
  if (input.action === "reopen") await requestReview(projectId, input.jobId);
  return { saved: true };
}
