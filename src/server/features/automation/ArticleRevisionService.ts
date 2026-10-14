import { researchArticle, RESEARCH_GUIDANCE } from "./ArticleResearchService";
import { revisionSources } from "./RevisionSources";
import { revisionMessage } from "@/types/schemas/articlePassages";
import { AutomationRepository as jobs } from "./AutomationRepository";
import { ArticleRevisionRepository as revisions } from "./ArticleRevisionRepository";
import { ContentLearningRepository as learning } from "./ContentLearningRepository";
import { contextSnapshot } from "./AutomationService";
import { boundedResult } from "./AutomationResult";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import {
  MAX_ARTICLE_VERSION,
  renderArticle,
  type AutomationResult,
} from "@/types/schemas/automation";
import { AppError } from "@/server/lib/errors";
import { prepareFeaturedImage } from "./FeaturedImageService";
import { executionHookRequest } from "./n8nExecution";
import { requestClientReview } from "./DraftReviewService";

type Job = NonNullable<Awaited<ReturnType<typeof jobs.job>>>;
type Policy = NonNullable<Awaited<ReturnType<typeof jobs.policy>>>;
type Feedback = Awaited<
  ReturnType<typeof learning.history>
>["feedback"][number];

const EDITORIAL_GUIDANCE =
  "Editorial guidance: Unanswered research questions, missing case studies, incomplete analytics, and site inventory limitations do not block revision or approval. Apply reviewer feedback using available evidence. Omit unsupported numbers and client-specific claims; do not invent examples or experience. General advice and clearly hypothetical examples are allowed. Judge the finished article for unsupported claims, not for optional information that was never provided.";

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
  const history = await learning.history(projectId, id);
  const feedback = history.feedback.filter(
    (item) => item.artifactVersion === version,
  );
  if (!feedback.length || !job.bodyHtml) throw new AppError("CONFLICT");
  if (!(await learning.claim(projectId, id, version))) return null;
  await runClaimedRevision(job, policy, project.domain, feedback);
  const updated = await jobs.job(projectId, id);
  // Email only for projects already configured for automatic review delivery.
  return updated && policy.autopilot
    ? { projectId, id, state: updated.state }
    : null;
}

async function runClaimedRevision(
  job: Job,
  policy: Policy,
  domain: string,
  feedback: Feedback[],
) {
  const { projectId, id, version } = job;
  let dispatched = false;
  let preparationFailure =
    "Revision could not start. Check the project policy, Context, and monthly allowance, then request it again.";
  try {
    if (
      !(await jobs.reserve(
        projectId,
        id,
        policy.version,
        new Date().toISOString().slice(0, 7),
      ))
    )
      throw new AppError("CONFLICT");
    const snapshot = await contextSnapshot(projectId);
    const source = await revisionSources(
      projectId,
      job.requestKey,
      job.targetUrl,
      domain,
    );
    if (!source.pages.length) {
      preparationFailure =
        "Revision could not start because the site's source page could not be read. Check site access or refresh the saved brief, then request it again.";
      throw new AppError("UPSTREAM_UNAVAILABLE");
    }
    const externalSources = await researchArticle(
      projectId,
      id,
      version + 1,
      job.topic,
    );
    if (!(await jobs.policy(projectId))?.enabled)
      throw new AppError("CONFLICT");
    await jobs.update(projectId, id, {
      contextVersion: snapshot.version,
      policyVersion: policy.version,
    });
    const request = await executionHookRequest("openseo-content-job", {
      jobId: id,
      projectId,
      contextVersion: snapshot.version,
      policyVersion: policy.version,
      context:
        snapshot.rendered +
        "\n\n" +
        RESEARCH_GUIDANCE +
        "\n\n" +
        EDITORIAL_GUIDANCE +
        (source.warning ? "\n\n" + source.warning : ""),
      feedback: [],
      revision: {
        version: version + 1,
        previousTitle: job.title ?? job.topic,
        previousBodyHtml: job.bodyHtml,
        comments: feedback.map((item) => ({
          message: revisionMessage(item.message, item.passages),
          instruction: item.instruction ?? "",
          scope: item.scope,
        })),
      },
      lease: {
        jobId: id,
        projectId,
        reserved: true,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      },
      policy: {
        enabled: true,
        paused: false,
        contentAllowed: true,
        approval: policy.approval,
        publication: "manual",
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
    });
    dispatched = true;
    const result = await boundedResult(await fetch(request));
    assertRevisionIdentity(result, {
      projectId,
      id,
      version: version + 1,
      contextVersion: snapshot.version,
      policyVersion: policy.version,
    });
    await saveRevision(job, result, source.warning);
  } catch (error) {
    console.error("automation.revision failed:", error, {
      projectId,
      jobId: id,
      version,
      dispatched,
    });
    await revisions.failRevision(
      projectId,
      id,
      version,
      dispatched ? "outcome_unknown" : "needs_revision",
      dispatched
        ? "Revision outcome could not be verified. Inspect n8n before retrying; the project slot remains reserved."
        : preparationFailure,
    );
    if (!dispatched) await jobs.releaseSlot(projectId, id, true);
  }
}

async function saveRevision(
  job: Job,
  result: AutomationResult,
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
      n8nExecutionId: result.n8nExecutionId,
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
  if (passed) await requestClientReview(projectId, id);
}

function assertRevisionIdentity(
  result: AutomationResult,
  expected: {
    projectId: string;
    id: string;
    version: number;
    contextVersion: string;
    policyVersion: string;
  },
) {
  if (
    result.artifactVersion !== expected.version ||
    result.jobId !== expected.id ||
    result.projectId !== expected.projectId ||
    result.contextVersion !== expected.contextVersion ||
    result.policyVersion !== expected.policyVersion
  )
    throw new AppError("CONFLICT");
}
