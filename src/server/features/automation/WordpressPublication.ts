import { z } from "zod";
import { symmetricEncrypt, symmetricDecrypt } from "better-auth/crypto";
import { getAuth } from "@/lib/auth";
import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import { SITE_USER_AGENT } from "@/shared/site-user-agent";
import { AutopilotRepository as auto } from "./AutopilotRepository";
import { AutomationRepository as jobs } from "./AutomationRepository";
import { validateTarget } from "./AutomationService";
import { AppError } from "@/server/lib/errors";
import { boundedJson } from "./AutomationResult";
import type { wordpressSetup } from "@/types/schemas/autopilot";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { FeaturedImageRepository as images } from "./FeaturedImageRepository";
import { readFeaturedImage } from "./FeaturedImageCodec";
import {
  classifyWordpressVerificationResponse,
  WordpressConnectionError,
} from "./WordpressConnectionResponse";
const postSchema = z.object({
  id: z.number().int().positive(),
  link: z.string().url(),
  status: z.string(),
  slug: z.string(),
});
async function wpRequest(
  connection: { baseUrl: string; username: string; passwordCipher: string },
  path: string,
  body?: unknown,
  verification = false,
) {
  await normalizeAndValidateStartUrl(connection.baseUrl);
  const { secretConfig } = await getAuth().$context;
  const password = await symmetricDecrypt({
    key: secretConfig,
    data: connection.passwordCipher,
  });
  let response: Response;
  try {
    response = await fetch(`${connection.baseUrl}/wp-json/wp/v2/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Basic ${btoa(connection.username + ":" + password)}`,
        "content-type": "application/json",
        "user-agent": SITE_USER_AGENT,
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    if (verification) throw new WordpressConnectionError("network");
    throw error;
  }
  if (verification) {
    const reason = classifyWordpressVerificationResponse(response);
    if (reason) throw new WordpressConnectionError(reason);
    try {
      return await boundedJson(response);
    } catch {
      throw new WordpressConnectionError("invalid_response");
    }
  }
  return boundedJson(response);
}
async function wpUploadMedia(
  connection: { baseUrl: string; username: string; passwordCipher: string },
  bytes: Uint8Array,
  filename: string,
) {
  await normalizeAndValidateStartUrl(connection.baseUrl);
  const { secretConfig } = await getAuth().$context;
  const password = await symmetricDecrypt({
    key: secretConfig,
    data: connection.passwordCipher,
  });
  const response = await fetch(`${connection.baseUrl}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(connection.username + ":" + password)}`,
      "content-type": "image/webp",
      "content-disposition": `attachment; filename="${filename}"`,
      "user-agent": SITE_USER_AGENT,
    },
    body: Uint8Array.from(bytes),
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  return z
    .object({ id: z.number().int().positive() })
    .parse(await boundedJson(response)).id;
}
export async function connectWordpress(
  projectId: string,
  domain: string,
  input: z.infer<typeof wordpressSetup>,
) {
  const baseUrl = validateTarget(input.baseUrl, domain).replace(/\/$/, "");
  const url = new URL(baseUrl);
  if (
    url.search ||
    url.hash ||
    /(?:^|\/)(?:wp-admin|wp-login\.php|wp-json)(?:\/|$)/i.test(url.pathname)
  )
    throw new AppError("VALIDATION_ERROR");
  await normalizeAndValidateStartUrl(baseUrl);
  const { secretConfig } = await getAuth().$context;
  const connection = {
    projectId,
    baseUrl,
    username: input.username,
    passwordCipher: await symmetricEncrypt({
      key: secretConfig,
      data: input.applicationPassword.replace(/\s/g, ""),
    }),
    version: crypto.randomUUID(),
    verifiedAt: new Date().toISOString(),
  };
  const user = z
    .object({ capabilities: z.record(z.string(), z.boolean()) })
    .safeParse(
      await wpRequest(connection, "users/me?context=edit", undefined, true),
    );
  if (!user.success) throw new WordpressConnectionError("invalid_response");
  if (
    !user.data.capabilities.publish_posts ||
    !user.data.capabilities.edit_posts
  )
    throw new WordpressConnectionError("permission");
  await auto.saveWordpress(connection);
}
const blockedMessage =
  "Publication stopped before anything was sent to WordPress. Check the WordPress connection, or publish by hand.";

// Publishes exactly what was approved; Context or settings edited since then
// do not matter, but the delivery choice and the connection must not have.
async function freshRelease(projectId: string, id: string) {
  const [job, policy, connection, project] = await Promise.all([
    jobs.job(projectId, id),
    jobs.policy(projectId),
    auto.wordpress(projectId),
    ProjectRepository.getProjectById(projectId),
  ]);
  if (!job || !policy || !project?.domain) throw new AppError("CONFLICT");
  if (policy.delivery !== "wordpress")
    throw new AppError(
      "CONFLICT",
      "Delivery was switched to manual after approval. Copy and publish this article by hand, or return it to draft.",
    );
  if (!connection || job.wordpressVersion !== connection.version)
    throw new AppError(
      "CONFLICT",
      "The WordPress connection changed after approval. Return the article to draft and approve it again to publish with the current connection.",
    );
  if (!job.qualityPassed || !job.bodyHtml || job.kind !== "new_content")
    throw new AppError("CONFLICT");
  validateTarget(connection.baseUrl, project.domain);
  return { job, connection };
}
export async function publishApprovedDraft(projectId: string, id: string) {
  if (!(await auto.claimPublication(projectId, id))) return;
  let dispatched = false;
  try {
    let { job, connection } = await freshRelease(projectId, id);
    // Store the selected media id before post creation. Unknown media writes hold publication.
    let featuredMediaId: number | undefined;
    if (job.featuredImageId) {
      const image = await images.image(projectId, job.featuredImageId);
      if (
        !image ||
        image.jobId !== id ||
        image.artifactVersion !== job.version ||
        image.status !== "ready" ||
        !image.r2Key ||
        image.altText.trim().length < 15
      )
        throw new AppError("CONFLICT");
      featuredMediaId = image.wordpressMediaId ?? undefined;
      if (!featuredMediaId) {
        const bytes = await readFeaturedImage(image.r2Key);
        dispatched = true;
        featuredMediaId = await wpUploadMedia(
          connection,
          bytes,
          `featured-${id.slice(0, 8)}-v${job.version}.webp`,
        );
        if (
          !(await images.setWordpressMedia(
            projectId,
            image.id,
            featuredMediaId,
          ))
        )
          throw new AppError("CONFLICT");
        // If alt metadata cannot be confirmed, hold publication for reconciliation.
        // The persisted media id prevents any duplicate upload.
        await wpRequest(connection, `media/${featuredMediaId}`, {
          alt_text: image.altText,
        });
      }
    }
    // Create an unpublished WordPress post first. Persist its id before the publish call.
    // Unknown writes are held for reconciliation; never blindly POST again.
    let postId = job.wordpressPostId;
    if (!postId) {
      dispatched = true;
      const slug =
        (job.title ?? job.topic)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 70)
          .replace(/-$/, "") +
        "-" +
        job.id.slice(0, 8);
      const draft = postSchema.parse(
        await wpRequest(connection, "posts", {
          status: "draft",
          slug,
          title: job.title ?? job.topic,
          content: job.bodyHtml,
          excerpt: job.metaDescription ?? "",
          ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
        }),
      );
      if (draft.status !== "draft") throw new AppError("CONFLICT");
      postId = draft.id;
      await jobs.update(projectId, id, { wordpressPostId: postId });
    }
    ({ job, connection } = await freshRelease(projectId, id));
    dispatched = true;
    const published = postSchema.parse(
      await wpRequest(connection, `posts/${postId}`, { status: "publish" }),
    );
    if (published.id !== postId || published.status !== "publish")
      throw new AppError("CONFLICT");
    await jobs.update(projectId, id, {
      state: "published",
      publishedUrl: published.link,
      publishedAt: new Date().toISOString(),
      message: "Published to WordPress after approval.",
    });
  } catch (error) {
    console.error("automation.wordpress-publish failed:", error, {
      projectId,
      jobId: id,
      dispatched,
    });
    const reason =
      error instanceof AppError && error.message !== error.code
        ? error.message
        : blockedMessage;
    await jobs.update(projectId, id, {
      state: dispatched ? "publication_unknown" : "publication_blocked",
      message: dispatched
        ? "WordPress outcome needs reconciliation. No automatic repeat publish will be attempted."
        : reason,
    });
  }
}
