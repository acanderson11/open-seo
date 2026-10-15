import {
  validateFeedback,
  type ContentFeedback,
} from "@/types/schemas/contentFeedback";
import { MAX_ARTICLE_VERSION } from "@/types/schemas/automation";
import { z } from "zod";
import { AutopilotRepository as auto } from "./AutopilotRepository";
import { AutomationRepository as jobs } from "./AutomationRepository";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import { FeaturedImageRepository as featuredImages } from "./FeaturedImageRepository";
import { approvedDelivery } from "./ArticleDelivery";
import { reviewEmailConfig, sendReviewEmail } from "./ReviewEmail";

type Job = NonNullable<Awaited<ReturnType<typeof jobs.job>>>;
type Decision = "approved" | "changes_requested";

const emptyFeedback: ContentFeedback = {
  message: "",
  scope: "article",
  category: "voice",
  instruction: "",
};

export async function reviewTokenHash(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function reviewOrigin() {
  const value = await getOptionalEnvValue("AGENCY_REVIEW_ORIGIN");
  if (!value) throw new AppError("AUTH_CONFIG_MISSING");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new AppError("AUTH_CONFIG_MISSING");
  return url.origin;
}

/**
 * Emails a private review link for the current version. Client approval
 * always uses a link; agency reviewers get one only under autopilot, since
 * otherwise they review in OpenSEO.
 */
export async function notifyReviewer(projectId: string, id: string) {
  const job = await jobs.job(projectId, id),
    policy = await jobs.policy(projectId);
  if (
    !job ||
    !policy?.reviewerEmail ||
    !policy.enabled ||
    job.state !== "awaiting_approval" ||
    !(
      policy.approval === "client" ||
      (policy.approval === "agency" && policy.autopilot)
    )
  )
    throw new AppError("CONFLICT");
  const origin = await reviewOrigin();
  await reviewEmailConfig();
  const delivery = await approvedDelivery(projectId, job.kind);
  if (!(await auto.claimNotification(projectId, id))) return;
  try {
    const token = crypto.randomUUID() + crypto.randomUUID(),
      tokenHash = await reviewTokenHash(token);
    await auto.saveLink({
      tokenHash,
      projectId,
      jobId: id,
      artifactVersion: job.version,
      role: policy.approval,
      recipient: policy.reviewerEmail,
      expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
    });
    await sendReviewEmail({
      to: policy.reviewerEmail,
      title: job.title ?? job.topic,
      reviewUrl: `${origin}/review#${token}`,
      expiresDays: 14,
      delivery: delivery.wordpressVersion ? "wordpress" : "manual",
      idempotencyKey: `review-link/${tokenHash}`,
    });
    await jobs.update(projectId, id, { notificationState: "sent" });
  } catch (error) {
    console.error("automation.review-notification failed:", error, {
      projectId,
      jobId: id,
    });
    await jobs.update(projectId, id, {
      notificationState: "unknown",
      message:
        "Review email delivery could not be confirmed. Agency can review in OpenSEO; client delivery needs attention.",
    });
    throw new AppError("UPSTREAM_UNAVAILABLE");
  }
}

/**
 * Emails the review link once a version passes quality review, for projects
 * that review by link: every client-approval project, and agency projects on
 * autopilot. Failures are recorded on the job by notifyReviewer.
 */
export async function requestReview(projectId: string, id: string) {
  const policy = await jobs.policy(projectId);
  if (
    !policy?.reviewerEmail ||
    !(
      policy.approval === "client" ||
      (policy.approval === "agency" && policy.autopilot)
    )
  )
    return;
  try {
    await notifyReviewer(projectId, id);
  } catch (error) {
    console.error("automation.review-request failed:", error, {
      projectId,
      jobId: id,
    });
  }
}

const reviewableStates = (decision: Decision) =>
  decision === "changes_requested"
    ? ["awaiting_approval", "needs_revision"]
    : ["awaiting_approval"];

const revisionState = (version: number) =>
  version >= MAX_ARTICLE_VERSION ? "needs_revision" : "revision_queued";

async function assertImageReady(projectId: string, job: Job) {
  if (!job.featuredImageId) return;
  const image = await featuredImages.image(projectId, job.featuredImageId);
  if (
    !image ||
    image.jobId !== job.id ||
    image.artifactVersion !== job.version ||
    image.status !== "ready" ||
    image.altText.trim().length < 15
  )
    throw new AppError("CONFLICT");
}

// Approval is of this exact version. Context or settings edited since it was
// drafted do not block it; the reviewer sees that the Context has changed.
async function nextTransition(projectId: string, job: Job, decision: Decision) {
  if (decision === "changes_requested")
    return { state: revisionState(job.version) };
  if (!job.qualityPassed) throw new AppError("CONFLICT");
  await assertImageReady(projectId, job);
  return approvedDelivery(projectId, job.kind);
}

export async function decideDraft(
  projectId: string,
  jobId: string,
  actorId: string,
  decision: Decision,
  review: {
    version: number;
    feedback?: ContentFeedback;
    featuredImageId: string | null;
  },
) {
  const { version, feedback, featuredImageId } = review;
  const job = await jobs.job(projectId, jobId),
    policy = await jobs.policy(projectId);
  if (!job || !policy) throw new AppError("NOT_FOUND");
  // An agency actor can never stand in for client approval.
  if (policy.approval !== "agency") throw new AppError("FORBIDDEN");
  if (
    !policy.enabled ||
    job.version !== version ||
    job.featuredImageId !== featuredImageId ||
    !job.bodyHtml ||
    !reviewableStates(decision).includes(job.state)
  )
    throw new AppError("CONFLICT");
  const transition = await nextTransition(projectId, job, decision);
  if (
    !(await jobs.approve(projectId, jobId, actorId, decision, {
      ...transition,
      artifactVersion: version,
      featuredImageId,
      feedback: validateFeedback(
        decision,
        feedback ?? emptyFeedback,
        job.bodyHtml,
      ),
    }))
  )
    throw new AppError("CONFLICT");
  return jobs.job(projectId, jobId);
}

export async function loadPrivateReview(token: string) {
  const tokenHash = await reviewTokenHash(z.string().length(72).parse(token)),
    link = await auto.link(tokenHash);
  if (!link || link.usedAt || link.expiresAt <= new Date().toISOString())
    throw new AppError("FORBIDDEN");
  const job = await jobs.job(link.projectId, link.jobId),
    policy = await jobs.policy(link.projectId);
  if (
    !job ||
    !policy?.enabled ||
    policy.approval !== link.role ||
    policy.reviewerEmail !== link.recipient ||
    job.version !== link.artifactVersion ||
    job.state !== "awaiting_approval" ||
    !job.qualityPassed
  )
    throw new AppError("CONFLICT");
  await assertImageReady(link.projectId, job);
  const delivery = await approvedDelivery(link.projectId, job.kind);
  return {
    link,
    job,
    tokenHash,
    delivery: delivery.wordpressVersion ? "wordpress" : "manual",
  };
}
export async function decidePrivateReview(
  token: string,
  decision: Decision,
  feedback?: ContentFeedback,
) {
  const { link, job, tokenHash } = await loadPrivateReview(token);
  const role = z.enum(["agency", "client"]).parse(link.role);
  const transition = await nextTransition(link.projectId, job, decision);
  if (
    !(await jobs.approve(
      link.projectId,
      job.id,
      `private-link:${tokenHash}`,
      decision,
      {
        ...transition,
        role,
        artifactVersion: job.version,
        featuredImageId: job.featuredImageId,
        feedback: validateFeedback(
          decision,
          feedback ?? emptyFeedback,
          job.bodyHtml ?? "",
        ),
      },
    ))
  )
    throw new AppError("CONFLICT");
  await auto.useLink(tokenHash);
  return {
    projectId: link.projectId,
    jobId: job.id,
    message:
      decision === "approved"
        ? transition.state === "ready_to_publish"
          ? "Approved. WordPress publishing is queued."
          : "Approved. The article is ready for manual copy/paste. Nothing has been published automatically."
        : "Feedback saved. A revised draft will need a new approval. After three revisions, the agency takes over.",
  };
}
