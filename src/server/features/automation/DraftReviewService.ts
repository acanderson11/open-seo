import {
  validateFeedback,
  type ContentFeedback,
} from "@/types/schemas/contentFeedback";
import { z } from "zod";
import { AutopilotRepository as auto } from "./AutopilotRepository";
import { AutomationRepository as jobs } from "./AutomationRepository";
import { contextSnapshot } from "./AutomationService";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import { FeaturedImageRepository as featuredImages } from "./FeaturedImageRepository";
import { boundedJson } from "./WordpressPublication";
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
export async function notifyReviewer(projectId: string, id: string) {
  const job = await jobs.job(projectId, id),
    policy = await jobs.policy(projectId);
  if (
    !job ||
    !policy?.reviewerEmail ||
    !policy.enabled ||
    !policy.autopilot ||
    job.state !== "awaiting_approval" ||
    !["agency", "client"].includes(policy.approval)
  )
    throw new AppError("CONFLICT");
  const origin = await reviewOrigin(),
    secret = await getOptionalEnvValue("AGENCY_N8N_EXECUTION_SECRET");
  if (!secret) throw new AppError("AUTH_CONFIG_MISSING");
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
    const result = z.object({ sent: z.literal(true) }).parse(
      await boundedJson(
        await fetch(
          "https://n8n.andmktg.com/webhook/openseo-review-notification",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-openseo-execution-secret": secret,
            },
            body: JSON.stringify({
              recipient: policy.reviewerEmail,
              title: job.title ?? job.topic,
              reviewUrl: `${origin}/review#${token}`,
              expiresDays: 14,
            }),
            redirect: "manual",
            signal: AbortSignal.timeout(30000),
          },
        ),
      ),
    );
    if (result.sent)
      await jobs.update(projectId, id, { notificationState: "sent" });
  } catch {
    await jobs.update(projectId, id, {
      notificationState: "unknown",
      message:
        "Review email delivery could not be confirmed. Agency can review in OpenSEO; client delivery needs attention.",
    });
    throw new AppError("UPSTREAM_UNAVAILABLE");
  }
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
    !policy.autopilot ||
    policy.approval !== link.role ||
    policy.reviewerEmail !== link.recipient ||
    job.version !== link.artifactVersion ||
    job.policyVersion !== policy.version ||
    job.state !== "awaiting_approval" ||
    !job.qualityPassed
  )
    throw new AppError("CONFLICT");
  if ((await contextSnapshot(link.projectId)).version !== job.contextVersion)
    throw new AppError("CONFLICT");
  if (job.featuredImageId) {
    const image = await featuredImages.image(link.projectId, job.featuredImageId);
    if (!image || image.jobId !== job.id || image.artifactVersion !== job.version || image.status !== "ready" || image.altText.trim().length < 15)
      throw new AppError("CONFLICT");
  }
  return {
    link,
    job,
    tokenHash,
    delivery:
      policy.delivery === "wordpress" && !!job.wordpressVersion
        ? "wordpress"
        : "manual",
  };
}
export async function decidePrivateReview(
  token: string,
  decision: "approved" | "changes_requested",
  feedback?: ContentFeedback,
) {
  const { link, job, tokenHash, delivery } = await loadPrivateReview(token);
  const validated = validateFeedback(
    decision,
    feedback ?? {
      message: "",
      scope: "article",
      category: "voice",
      instruction: "",
    },
    job.bodyHtml ?? "",
  );
  const role = z.enum(["agency", "client"]).parse(link.role);
  if (
    !(await jobs.approve(
      link.projectId,
      job.id,
      `private-link:${tokenHash}`,
      decision,
      {
        state:
          decision === "approved"
            ? "ready_for_manual_publication"
            : job.version >= 4
              ? "needs_revision"
              : "revision_queued",
        role,
        artifactVersion: job.version,
        featuredImageId: job.featuredImageId,
        feedback: validated,
      },
    ))
  )
    throw new AppError("CONFLICT");
  await auto.useLink(tokenHash);
  return {
    message:
      decision === "approved"
        ? delivery === "wordpress"
          ? "Approved. WordPress publishing is queued."
          : "Approved. The article is ready for manual copy/paste. Nothing has been published automatically."
        : "Feedback saved. A revised draft will need a new approval. After three revisions, the agency takes over.",
  };
}
