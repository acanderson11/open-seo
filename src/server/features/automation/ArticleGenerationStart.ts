import { env } from "cloudflare:workers";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { AutomationRepository as jobs } from "./AutomationRepository";
import { ArticleRevisionRepository as revisions } from "./ArticleRevisionRepository";
import type { GenerationRequest } from "./ArticleGenerationInput";

/** Which engine writes articles: n8n (default) or the in-app Workflow. */
export async function contentEngine(): Promise<"app" | "n8n"> {
  return (await getOptionalEnvValue("AGENCY_CONTENT_ENGINE")) === "app"
    ? "app"
    : "n8n";
}

/** One Workflow instance per article version, so a version can never run twice. */
export const generationInstanceId = (jobId: string, version: number) =>
  `${jobId}-v${version}`;

/**
 * Starts the in-app generation Workflow for a job whose slot is reserved.
 * If the start fails and no instance exists, nothing was charged: the job is
 * returned with its slot and allowance refunded.
 */
export async function startGeneration(request: GenerationRequest) {
  const { projectId, jobId, version } = request;
  const id = generationInstanceId(jobId, version);
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
    else
      await revisions.failRevision(
        projectId,
        jobId,
        version - 1,
        "needs_revision",
        message,
      );
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
