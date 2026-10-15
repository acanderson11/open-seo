import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { pgStep } from "./pgStep";
import {
  correctArticle,
  createBrief,
  failGeneration,
  prepareGeneration,
  reviewArticle,
  saveGeneration,
  writeArticle,
} from "@/server/features/automation/ArticleGenerationService";
import { preparationMessage } from "@/server/features/automation/ArticleRevisionService";
import type { GenerationRequest } from "@/server/features/automation/ArticleGenerationInput";

// Preparation reads the site and runs paid research searches: retry once.
const prepare = {
  retries: { limit: 1, delay: "10 seconds" as const },
  timeout: "5 minutes" as const,
};
// A failed model call (timeout, rate limit, or output that fails its schema)
// is retried; each attempt is one bounded, paid request.
const model = {
  retries: {
    limit: 2,
    delay: "15 seconds" as const,
    backoff: "exponential" as const,
  },
  timeout: "4 minutes" as const,
};
const record = {
  retries: { limit: 3, delay: "5 seconds" as const },
  timeout: "2 minutes" as const,
};

/** Drafts or revises one article version: brief, write, review, and at most one correction. */
export class ArticleGenerationWorkflow extends WorkflowEntrypoint<
  Env,
  GenerationRequest
> {
  async run(event: WorkflowEvent<GenerationRequest>, step: WorkflowStep) {
    const request = event.payload;
    const stage = {
      projectId: request.projectId,
      jobId: request.jobId,
      version: request.version,
    };
    let charged = false;
    let current = "Prepare sources and Context";
    try {
      const { job, warning } = await pgStep(step, current, prepare, () =>
        prepareGeneration(request),
      );
      charged = !job.savedBrief;
      current = "Write brief";
      const brief = await pgStep(step, current, model, () =>
        createBrief(stage, job),
      );
      charged = true;
      current = "Write article";
      let draft = await pgStep(step, current, model, () =>
        writeArticle(stage, job, brief),
      );
      current = "Review article";
      let review = await pgStep(step, current, model, () =>
        reviewArticle(stage, { job, brief, draft }, false),
      );
      if (!review.pass) {
        const first = review;
        current = "Correct review findings";
        draft = await pgStep(step, current, model, () =>
          correctArticle(stage, { job, brief, draft, review: first }),
        );
        const corrected = draft;
        current = "Review corrected article";
        review = await pgStep(step, current, model, () =>
          reviewArticle(stage, { job, brief, draft: corrected }, true),
        );
      }
      const result = { draft, review };
      current = "Save article version";
      await pgStep(step, current, record, () =>
        saveGeneration(request, result, warning),
      );
    } catch (error) {
      // The reason goes in as a string: Workers Logs kept only the last stack
      // line of a logged Error object.
      console.error("automation.generation failed", {
        ...stage,
        step: current,
        charged,
        reason: failureReason(error),
      });
      const failed = `"${current}" failed after retries: ${failureReason(error)}. The attempt counts toward the monthly allowance`;
      await pgStep(step, "Record failure", record, () =>
        failGeneration(request, {
          charged,
          message: charged
            ? request.version === 1
              ? `${failed}. Start it again when ready.`
              : `${failed}; your feedback is kept. Request it again when ready.`
            : request.version === 1
              ? preparationMessage(
                  error,
                  "Preparation failed before generation. Check Context and the source page.",
                )
              : preparationMessage(error),
        }),
      );
    }
  }
}

/** One line saying why a step failed, safe to show the agency on the article. */
function failureReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split("\n")[0] ?? "").slice(0, 200) || "unknown error";
}
