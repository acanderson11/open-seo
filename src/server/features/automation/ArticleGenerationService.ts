import { APICallError, generateText, NoObjectGeneratedError, Output } from "ai";
import type { z } from "zod";
import { getContentModel } from "@/server/lib/openrouter";
import { openRouterCostUsd } from "@/server/lib/chatAgent";
import { AppError } from "@/server/lib/errors";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import {
  articleBriefSchema,
  articleDraftSchema,
  articleReviewSchema,
  type ArticleBrief,
  type ArticleDraft,
  type ArticleReview,
} from "@/types/schemas/automation";
import { AutomationRepository as jobs } from "./AutomationRepository";
import { buildDraftJob, failDraft, saveDraft } from "./AutomationService";
import {
  buildRevisionJob,
  currentFeedback,
  failRevision,
  saveRevision,
} from "./ArticleRevisionService";
import {
  BRIEF_PROMPT,
  CONTENT_INSTRUCTIONS,
  CORRECT_PROMPT,
  REREVIEW_PROMPT,
  REVIEW_PROMPT,
  WRITE_PROMPT,
} from "./ArticleGenerationPrompts";
import type {
  GenerationJob,
  GenerationRequest,
} from "./ArticleGenerationInput";
import { generationInstanceId } from "./ArticleGenerationStart";

type Stage = { projectId: string; jobId: string; version: number };

/**
 * One structured model call. Throws on configuration, transport, or schema
 * failure so the Workflow step can retry it. Usage and cost are logged per call.
 */
export async function generateStage<T>(
  stage: Stage & { name: string },
  call: {
    system: string;
    prompt: string;
    input: unknown;
    schema: z.ZodType<T>;
    maxOutputTokens?: number;
  },
): Promise<T> {
  const content = await getContentModel();
  if (!content)
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      "Set OPENROUTER_CONTENT_MODEL to use the in-app article engine.",
    );
  let response;
  try {
    response = await generateText({
      model: content.model,
      system: call.system,
      prompt: call.prompt + JSON.stringify(call.input),
      output: Output.object({ schema: call.schema }),
      temperature: 0.2,
      maxOutputTokens: call.maxOutputTokens ?? 8000,
      // Reasoning tokens count against the output limit; keep them small so
      // the structured reply fits (the same setting briefs use).
      providerOptions: { openrouter: { reasoning: { effort: "low" } } },
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    if (APICallError.isInstance(error))
      console.error("automation.generation-stage request rejected", {
        ...stage,
        model: content.modelId,
        status: error.statusCode,
        body: error.responseBody?.slice(0, 1000),
      });
    if (!NoObjectGeneratedError.isInstance(error)) throw error;
    console.error("automation.generation-stage output rejected", {
      ...stage,
      model: content.modelId,
      finishReason: error.finishReason,
      usage: error.usage,
    });
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      error.finishReason === "length"
        ? "the model's reply was cut off at the output limit"
        : "the model's reply did not match the expected format",
    );
  }
  console.info("automation.generation-stage", {
    ...stage,
    model: content.modelId,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    costUsd: openRouterCostUsd(response.providerMetadata),
  });
  return response.output;
}

/** Every brief claim must quote one of the job's sources word for word. */
export function assertBriefEvidence(
  brief: ArticleBrief,
  sources: GenerationJob["sources"],
) {
  for (const claim of brief.claims) {
    const source = sources.find((item) => item.id === claim.sourceId);
    if (!source?.text.includes(claim.evidence))
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        "The brief quoted evidence that is not in its sources.",
      );
  }
  return brief;
}

export async function createBrief(stage: Stage, job: GenerationJob) {
  if (job.savedBrief) return assertBriefEvidence(job.savedBrief, job.sources);
  const brief = await generateStage(
    { ...stage, name: "brief" },
    {
      system: CONTENT_INSTRUCTIONS,
      prompt: BRIEF_PROMPT,
      input: job,
      schema: articleBriefSchema,
    },
  );
  return assertBriefEvidence(brief, job.sources);
}

export function writeArticle(
  stage: Stage,
  job: GenerationJob,
  brief: ArticleBrief,
) {
  return generateStage(
    { ...stage, name: "write" },
    {
      system: CONTENT_INSTRUCTIONS,
      prompt: WRITE_PROMPT,
      input: { job, brief },
      schema: articleDraftSchema,
    },
  );
}

/** An independent review; a blocking issue fails it even if the model says pass. */
export async function reviewArticle(
  stage: Stage,
  article: { job: GenerationJob; brief: ArticleBrief; draft: ArticleDraft },
  corrected: boolean,
): Promise<ArticleReview> {
  const review = await generateStage(
    { ...stage, name: corrected ? "re-review" : "review" },
    {
      system: CONTENT_INSTRUCTIONS,
      prompt: corrected ? REREVIEW_PROMPT : REVIEW_PROMPT,
      input: article,
      schema: articleReviewSchema,
    },
  );
  return {
    pass:
      review.pass &&
      !review.issues.some((issue) => issue.severity === "blocking"),
    issues: review.issues,
  };
}

export function correctArticle(
  stage: Stage,
  article: {
    job: GenerationJob;
    brief: ArticleBrief;
    draft: ArticleDraft;
    review: ArticleReview;
  },
) {
  return generateStage(
    { ...stage, name: "correct" },
    {
      system: CONTENT_INSTRUCTIONS,
      prompt: CORRECT_PROMPT,
      input: article,
      schema: articleDraftSchema,
    },
  );
}

/** Loads the job and builds the model input for this version. No paid model call. */
export async function prepareGeneration(request: GenerationRequest) {
  const { projectId, jobId, version } = request;
  const job = await jobs.job(projectId, jobId);
  if (version === 1) {
    if (job?.state !== "preparing" || !request.domain || !request.topic)
      throw new AppError("CONFLICT");
    await jobs.update(projectId, jobId, { state: "running" });
    return {
      job: await buildDraftJob({
        projectId,
        jobId,
        requestKey: job.requestKey,
        topic: request.topic,
        domain: request.domain,
        targetUrl: request.targetUrl ?? job.targetUrl,
        planned: request.planned,
      }),
      warning: null,
    };
  }
  const [policy, project] = await Promise.all([
    jobs.policy(projectId),
    ProjectRepository.getProjectById(projectId),
  ]);
  if (
    job?.state !== "revising" ||
    job.version !== version - 1 ||
    !policy ||
    !project?.domain
  )
    throw new AppError("CONFLICT");
  const feedback = await currentFeedback(projectId, jobId, job.version);
  return buildRevisionJob(job, policy, project.domain, feedback);
}

export async function saveGeneration(
  request: GenerationRequest,
  result: { draft: ArticleDraft; review: ArticleReview },
  warning: string | null,
) {
  const { projectId, jobId, version } = request;
  const executionId = "app:" + generationInstanceId(request);
  if (version === 1)
    return saveDraft(projectId, jobId, { ...result, executionId });
  const job = await jobs.job(projectId, jobId);
  if (job?.state !== "revising" || job.version !== version - 1)
    throw new AppError("CONFLICT");
  return saveRevision(job, { ...result, executionId }, warning);
}

/**
 * Ends a run that could not finish. Before any model call the attempt is
 * refunded; after one, it counts against the monthly allowance.
 */
export async function failGeneration(
  request: GenerationRequest,
  failure: { message: string; charged: boolean },
) {
  const { projectId, jobId, version } = request;
  if (version === 1)
    return failDraft(projectId, jobId, failure.message, !failure.charged);
  return failRevision(
    projectId,
    jobId,
    version - 1,
    failure.message,
    !failure.charged,
  );
}
