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
    try {
      const { job, warning } = await pgStep(
        step,
        "Prepare sources and Context",
        prepare,
        () => prepareGeneration(request),
      );
      charged = !job.savedBrief;
      const brief = await pgStep(step, "Write brief", model, () =>
        createBrief(stage, job),
      );
      charged = true;
      let draft = await pgStep(step, "Write article", model, () =>
        writeArticle(stage, job, brief),
      );
      let review = await pgStep(step, "Review article", model, () =>
        reviewArticle(stage, { job, brief, draft }, false),
      );
      if (!review.pass) {
        const first = review;
        draft = await pgStep(step, "Correct review findings", model, () =>
          correctArticle(stage, { job, brief, draft, review: first }),
        );
        const corrected = draft;
        review = await pgStep(step, "Review corrected article", model, () =>
          reviewArticle(stage, { job, brief, draft: corrected }, true),
        );
      }
      const result = { draft, review };
      await pgStep(step, "Save article version", record, () =>
        saveGeneration(request, result, warning),
      );
    } catch (error) {
      console.error("automation.generation failed:", error, {
        ...stage,
        charged,
      });
      await pgStep(step, "Record failure", record, () =>
        failGeneration(request, {
          charged,
          message: charged
            ? "Article generation stopped after retries. The attempt counts toward the monthly allowance; your feedback is kept. Request it again when ready."
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
