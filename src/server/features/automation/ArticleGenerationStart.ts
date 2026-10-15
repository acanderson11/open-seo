import { env } from "cloudflare:workers";
import { AutomationRepository as jobs } from "./AutomationRepository";
import { ArticleRevisionRepository as revisions } from "./ArticleRevisionRepository";
import type { GenerationRequest } from "./ArticleGenerationInput";

/**
 * One Workflow instance per run. Instance ids cannot be reused, so a version
 * that runs again (a retried draft or re-requested revision) needs a new run
 * id; job state and the project slot keep two runs from overlapping.
 */
export const generationInstanceId = ({
  jobId,
  version,
  runId,
}: GenerationRequest) => `${jobId}-v${version}${runId ? `-${runId}` : ""}`;

/**
 * Starts the in-app generation Workflow for a job whose slot is reserved.
 * If the start fails and no instance exists, nothing was charged: the job is
 * returned with its slot and allowance refunded.
 */
export async function startGeneration(input: GenerationRequest) {
  const request = { ...input, runId: crypto.randomUUID().slice(0, 8) };
  const { projectId, jobId, version } = request;
  const id = generationInstanceId(request);
  try {
    if (version === 1)
      await jobs.update(projectId, jobId, {
        state: "preparing",
        message: null,
      });
    await env.ARTICLE_GENERATION_WORKFLOW.create({ id, params: request });
  } catch (error) {
    if (await instanceExists(id)) return;
    console.error("automation.generation-start failed:", error, {
      projectId,
      jobId,
      version,
    });
    const message =
      "Article generation could not start. Nothing was charged; request it again.";
    if (version === 1)
      await jobs.update(projectId, jobId, { state: "failed", message });
    else await revisions.failRevision(projectId, jobId, version - 1, message);
    await jobs.releaseSlot(projectId, jobId, true);
  }
}

async function instanceExists(id: string) {
  try {
    await env.ARTICLE_GENERATION_WORKFLOW.get(id);
    return true;
  } catch {
    // get() rejects when no instance has this id.
    return false;
  }
}
