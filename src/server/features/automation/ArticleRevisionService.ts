import { researchArticle, RESEARCH_GUIDANCE } from "./ArticleResearchService";
import { revisionSources } from "./RevisionSources";
import { revisionMessage } from "@/types/schemas/articlePassages";
import { AutomationRepository as jobs } from "./AutomationRepository";
import { ArticleRevisionRepository as revisions } from "./ArticleRevisionRepository";
import { ContentLearningRepository as learning } from "./ContentLearningRepository";
import { contextSnapshot } from "./AutomationService";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import {
  MAX_ARTICLE_VERSION,
  renderArticle,
  type ArticleDraft,
  type ArticleReview,
} from "@/types/schemas/automation";
import { AppError } from "@/server/lib/errors";
import { prepareFeaturedImage } from "./FeaturedImageService";
import { requestReview } from "./DraftReviewService";
import { startGeneration } from "./ArticleGenerationStart";
import type { GenerationJob } from "./ArticleGenerationInput";

type Job = NonNullable<Awaited<ReturnType<typeof jobs.job>>>;
type Policy = NonNullable<Awaited<ReturnType<typeof jobs.policy>>>;
type Feedback = Awaited<
  ReturnType<typeof learning.history>
>["feedback"][number];

const EDITORIAL_GUIDANCE =
  "Editorial guidance: Unanswered research questions, missing case studies, incomplete analytics, and site inventory limitations do not block revision or approval. Apply reviewer feedback using available evidence. Omit unsupported numbers and client-specific claims; do not invent examples or experience. General advice and clearly hypothetical examples are allowed. Judge the finished article for unsupported claims, not for optional information that was never provided.";

const START_FAILURE =
  "Revision could not start. Check the project policy, Context, and monthly allowance, then request it again.";
const UNREADABLE_SOURCE =
  "Revision could not start because the site's source page could not be read. Check site access or refresh the saved brief, then request it again.";

/** Claims a queued revision, reserves the project's slot, and starts its generation run. */
export async function reviseArticle(
  projectId: string,
  id: string,
  version: number,
) {
  const job = await jobs.job(projectId, id),
    policy = await jobs.policy(projectId),
    project = await ProjectRepository.getProjectById(projectId);
  if (
    !job ||
    job.version !== version ||
    job.state !== "revision_queued" ||
    version >= MAX_ARTICLE_VERSION ||
    !policy?.enabled ||
    !project?.domain
  )
    return null;
  const feedback = await currentFeedback(projectId, id, version);
  if (!feedback.length || !job.bodyHtml) throw new AppError("CONFLICT");
  if (!(await learning.claim(projectId, id, version))) return null;
  if (
    !(await jobs.reserve(
      projectId,
      id,
      policy.version,
      new Date().toISOString().slice(0, 7),
    ))
  )
    await failRevision(projectId, id, version, START_FAILURE, true);
  else await startGeneration({ projectId, jobId: id, version: version + 1 });
  const updated = await jobs.job(projectId, id);
  return updated ? { projectId, id, state: updated.state } : null;
}

/**
 * Starts a just-queued revision now rather than at the next scheduler check.
 * A busy project slot leaves it queued for the scheduler.
 */
export async function startQueuedRevision(projectId: string, id: string) {
  const [job, policy] = await Promise.all([
    jobs.job(projectId, id),
    jobs.policy(projectId),
  ]);
  if (job?.state !== "revision_queued" || policy?.busyJobId) return;
  try {
    await reviseArticle(projectId, id, job.version);
  } catch (error) {
    // The scheduler retries anything still queued.
    console.error("automation.revision-start failed:", error, {
      projectId,
      jobId: id,
    });
  }
}

export async function currentFeedback(
  projectId: string,
  id: string,
  version: number,
) {
  const history = await learning.history(projectId, id);
  return history.feedback.filter((item) => item.artifactVersion === version);
}

/** Collects sources, Context, and reviewer comments for a revision. Runs before any paid model call. */
export async function buildRevisionJob(
  job: Job,
  policy: Policy,
  domain: string,
  feedback: Feedback[],
): Promise<{ job: GenerationJob; warning: string | null }> {
  const { projectId, id, version } = job;
  const snapshot = await contextSnapshot(projectId);
  const source = await revisionSources(
    projectId,
    job.requestKey,
    job.targetUrl,
    domain,
  );
  if (!source.pages.length)
    throw new AppError("UPSTREAM_UNAVAILABLE", UNREADABLE_SOURCE);
  const externalSources = await researchArticle(
    projectId,
    id,
    version + 1,
    job.topic,
  );
  if (!(await jobs.policy(projectId))?.enabled) throw new AppError("CONFLICT");
  await jobs.update(projectId, id, {
    contextVersion: snapshot.version,
    policyVersion: policy.version,
  });
  return {
    warning: source.warning,
    job: {
      contextVersion: snapshot.version,
      policyVersion: policy.version,
      context:
        snapshot.rendered +
        "\n\n" +
        RESEARCH_GUIDANCE +
        "\n\n" +
        EDITORIAL_GUIDANCE +
        (source.warning ? "\n\n" + source.warning : ""),
      revision: {
        version: version + 1,
        previousTitle: job.title ?? job.topic,
        previousBodyHtml: job.bodyHtml ?? "",
        comments: feedback.map((item) => ({
          message: revisionMessage(item.message, item.passages),
          instruction: item.instruction ?? "",
          scope: item.scope,
        })),
      },
      opportunity: {
        id: job.requestKey,
        kind: job.kind,
        topic: job.topic,
        intent:
          "Revise the existing article using the reviewer comments. Preserve supported, useful content. Never treat the previous draft or a factual correction as verified source evidence.",
        rationale: job.rationale ?? "Reviewer-requested revision",
        targetUrl: job.kind === "new_content" ? null : job.targetUrl,
      },
      sources: [
        ...source.pages.slice(0, 8).map((page, index) => ({
          id: "page-" + (index + 1),
          url: page.url,
          text: page.text,
        })),
        ...externalSources,
      ],
    },
  };
}

/** The custom message of a preparation error, or the generic start failure. */
export const preparationMessage = (error: unknown, fallback = START_FAILURE) =>
  error instanceof AppError && error.message !== error.code
    ? error.message
    : fallback;

/** Returns a revision to the reviewer with its feedback intact and frees the slot. */
export async function failRevision(
  projectId: string,
  id: string,
  version: number,
  message: string,
  refundUnused: boolean,
) {
  await revisions.failRevision(projectId, id, version, message);
  await jobs.releaseSlot(projectId, id, refundUnused);
}

/** Stores a revised version as a new artifact, frees the slot, and requests review. */
export async function saveRevision(
  job: Job,
  result: { draft: ArticleDraft; review: ArticleReview; executionId: string },
  warning: string | null,
) {
  const { projectId, id, version } = job;
  const revisedBody = renderArticle(result.draft);
  if (
    revisedBody.replace(/\s+/g, " ").trim() ===
    (job.bodyHtml ?? "").replace(/\s+/g, " ").trim()
  ) {
    await jobs.update(projectId, id, {
      state: "needs_revision",
      qualityPassed: 0,
      review:
        "blocking: The generated article is unchanged from the reviewed version.",
      message:
        "The revision returned the same article. Your feedback is saved on this version; review it and request another revision when ready.",
    });
    await jobs.releaseSlot(projectId, id);
    return;
  }
  const passed =
    result.review.pass &&
    !result.review.issues.some((issue) => issue.severity === "blocking");
  const completed = await revisions.completeRevision(
    projectId,
    id,
    version,
    job.featuredImageId ?? null,
    {
      state: passed ? "awaiting_approval" : "needs_revision",
      version: version + 1,
      title: result.draft.title,
      metaDescription: result.draft.metaDescription,
      bodyHtml: revisedBody,
      qualityPassed: passed ? 1 : 0,
      review: result.review.issues
        .map((issue) => issue.severity + ": " + issue.reason)
        .concat(warning ? ["warning: " + warning] : [])
        .join("\n"),
      n8nExecutionId: result.executionId,
      completedAt: new Date().toISOString(),
      message: passed
        ? warning
          ? "Revised from feedback using historical site evidence. Verify current business facts and dates before approval."
          : "Revised from feedback. Review and approve this version."
        : "Revision did not pass the quality review. Agency attention required.",
    },
  );
  if (!completed) throw new AppError("CONFLICT");
  if (passed) {
    try {
      await prepareFeaturedImage(
        { projectId, jobId: id, version: version + 1 },
        "system:image",
      );
    } catch (error) {
      // Keep the revised article available without an image.
      console.error("automation.revision-image failed:", error, {
        projectId,
        jobId: id,
      });
    }
  }
  await jobs.releaseSlot(projectId, id);
  if (passed) await requestReview(projectId, id);
}
