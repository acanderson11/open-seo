import { AppError } from "@/server/lib/errors";
import { AutomationRepository } from "./AutomationRepository";
import { FeaturedImageRepository as images } from "./FeaturedImageRepository";
import {
  decodeImageBase64,
  encodeImageBase64,
  normalizeFeaturedImage,
  readFeaturedImage,
  storeFeaturedImage,
} from "./FeaturedImageCodec";
import { generateConceptualImage, IMAGE_PROMPT_LIMIT } from "./OpenRouterImage";
import { captionConceptualImage } from "./OpenRouterImageCaption";
import { defaultImageBrief } from "./ImageVisualBrief";

const imageKey = (
  projectId: string,
  jobId: string,
  version: number,
  id: string,
) => `featured-images/${projectId}/${jobId}/${version}/${id}.webp`;
const assetKey = (projectId: string, id: string) =>
  `project-images/${projectId}/${id}.webp`;

export function imagePrompt(input: {
  title: string;
  topic: string;
  visualBrief: string;
  feedback: string;
  style: string;
  colors: string;
  reference: string;
  avoid: string;
  guidance: string;
}) {
  return [
    "Non-negotiable: no words, letters, numbers, captions, text overlays, logos, watermarks, fake screenshots, fake interfaces, fake charts, or named brands. Do not portray a specific client's office or staff.",
    "Wide 16:9 editorial composition, readable at thumbnail size.",
    input.feedback &&
      `Apply the current image feedback: ${input.feedback.slice(0, 500)}.`,
    input.guidance &&
      `Remembered image feedback: ${input.guidance.slice(0, 1000)}.`,
    input.avoid && `Avoid: ${input.avoid.slice(0, 300)}.`,
    input.style && `Style: ${input.style.slice(0, 300)}.`,
    input.colors && `Colors: ${input.colors.slice(0, 180)}.`,
    input.reference &&
      `Visual reference notes: ${input.reference.slice(0, 300)}.`,
    `Create one editorial featured image, following the requested visual style, for a business article titled “${input.title.slice(0, 180)}”.`,
    `Topic: ${input.topic.slice(0, 300)}.`,
    `Visual direction: ${input.visualBrief.slice(0, 600) || "A clear conceptual scene grounded in the article topic."}`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, IMAGE_PROMPT_LIMIT);
}

async function currentDraft(projectId: string, jobId: string, version: number) {
  const job = await AutomationRepository.job(projectId, jobId);
  if (
    !job ||
    job.version !== version ||
    !job.bodyHtml ||
    ![
      "awaiting_approval",
      "needs_revision",
      "ready_for_manual_publication",
    ].includes(job.state) ||
    job.wordpressPostId ||
    job.publishedUrl
  )
    throw new AppError("CONFLICT");
  return job;
}

export async function prepareFeaturedImage(
  projectId: string,
  jobId: string,
  version: number,
  actorId: string,
  visualBrief = "",
  feedback = "",
  rememberFeedback = false,
  force = false,
) {
  const job = await currentDraft(projectId, jobId, version);
  if (!force && job.featuredImageId) return images.selected(projectId, jobId);
  const preferences = await images.preferences(projectId);
  if (!force && preferences?.autoGenerate !== 1) return null;
  if (
    rememberFeedback &&
    feedback.trim() &&
    !(await images.rememberFeedback(projectId, feedback.trim()))
  )
    throw new AppError("CONFLICT");
  const refreshed = rememberFeedback
    ? await images.preferences(projectId)
    : preferences;
  const preferred = refreshed?.preferredAssetId
    ? await images.asset(projectId, refreshed.preferredAssetId)
    : null;
  if (preferred && !force && !visualBrief.trim() && !feedback.trim()) {
    const id = crypto.randomUUID();
    const inserted = await images.begin({
      id,
      projectId,
      jobId,
      artifactVersion: version,
      status: "ready",
      source: "client",
      r2Key: preferred.r2Key,
      sourceAssetId: preferred.id,
      sourceUrl: preferred.sourceUrl,
      rightsNote: preferred.rightsNote,
      visualBrief: "Preferred project asset",
      altText: preferred.altText,
      bytes: preferred.bytes,
      actorId,
      createdAt: new Date().toISOString(),
    });
    if (
      inserted &&
      (await images.select(projectId, jobId, version, id, actorId))
    )
      return images.image(projectId, id);
    return null;
  }
  const id = crypto.randomUUID();
  const brief =
    visualBrief.trim().slice(0, 600) ||
    defaultImageBrief(job.title ?? job.topic, job.topic);
  const prompt = imagePrompt({
    title: job.title ?? job.topic,
    topic: job.topic,
    visualBrief: brief,
    feedback: feedback.trim(),
    style: refreshed?.style ?? "",
    colors: refreshed?.colors ?? "",
    reference: refreshed?.reference ?? "",
    avoid: refreshed?.avoid ?? "",
    guidance: refreshed?.guidance ?? "",
  });
  if (
    !(await images.begin({
      id,
      projectId,
      jobId,
      artifactVersion: version,
      status: "generating",
      source: "generated",
      model: null,
      prompt,
      visualBrief: brief,
      altText: "",
      actorId,
      createdAt: new Date().toISOString(),
    }))
  )
    return null;
  let stage = "draft eligibility";
  try {
    // A publication claim may have won after the first draft read. Do not pay
    // for an image that can no longer become part of this reviewed version.
    await currentDraft(projectId, jobId, version);
    // Exactly one paid generation attempt; no automatic retries after an uncertain result.
    stage = "provider request or response";
    const generated = await generateConceptualImage(prompt);
    stage = "provider metadata persistence";
    if (
      !(await images.recordProviderResult(
        projectId,
        id,
        generated.model,
        generated.costUsd,
      ))
    )
      throw new AppError(
        "CONFLICT",
        "Image attempt changed before provider metadata could be saved.",
      );
    stage = "source inspection or WebP conversion";
    const normalized = await normalizeFeaturedImage(generated.bytes);
    stage = "visual caption check";
    const caption = await captionConceptualImage(normalized.bytes);
    if (caption.forbidden)
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        `The visual check flagged writing, a logo, or an invented interface.${caption.reason ? " " + caption.reason : ""} The image was not selected. Use a previous image, upload one, or try a physical scene without screens or printed objects.`,
      );
    if (!caption.alt)
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        "The generated image could not be visually captioned. Upload or generate a replacement.",
      );
    const r2Key = imageKey(projectId, jobId, version, id);
    stage = "storage";
    await storeFeaturedImage(r2Key, normalized.bytes);
    stage = "record finalization";
    if (
      !(await images.finish(projectId, id, {
        r2Key,
        model: generated.model,
        costUsd: generated.costUsd,
        rightsNote:
          "Generated through OpenRouter. Review provider terms before external reuse.",
        bytes: normalized.bytes.length,
        altText: caption.alt,
      }))
    )
      throw new AppError("CONFLICT");
    stage = "selection";
    if (!(await images.select(projectId, jobId, version, id, actorId)))
      throw new AppError(
        "CONFLICT",
        "Image was saved, but the draft changed before it could be selected.",
      );
  } catch (error) {
    const detail =
      error instanceof AppError && error.message !== error.code
        ? ` ${error.message}`
        : "";
    await images.fail(projectId, id, `Image ${stage} failed.${detail}`);
  }
  return images.image(projectId, id);
}

export async function uploadProjectImageAsset(
  projectId: string,
  actorId: string,
  input: {
    filename: string;
    imageBase64: string;
    sourceUrl?: string;
    rightsNote: string;
    altText: string;
  },
) {
  const id = crypto.randomUUID();
  const normalized = await normalizeFeaturedImage(
    decodeImageBase64(input.imageBase64),
  );
  const r2Key = assetKey(projectId, id);
  await storeFeaturedImage(r2Key, normalized.bytes);
  if (
    !(await images.addAsset({
      id,
      projectId,
      r2Key,
      filename: input.filename,
      sourceUrl: input.sourceUrl ?? null,
      rightsNote: `${input.rightsNote.trim()} (uploaded by ${actorId})`,
      altText: input.altText.trim(),
      bytes: normalized.bytes.length,
      createdAt: new Date().toISOString(),
    }))
  )
    throw new AppError("CONFLICT");
  return images.asset(projectId, id);
}

export async function replaceFeaturedImage(
  projectId: string,
  jobId: string,
  version: number,
  actorId: string,
  input: {
    filename: string;
    imageBase64: string;
    source: "client" | "stock";
    sourceUrl?: string;
    rightsNote: string;
    altText: string;
    visualBrief: string;
  },
) {
  await currentDraft(projectId, jobId, version);
  const id = crypto.randomUUID();
  const normalized = await normalizeFeaturedImage(
    decodeImageBase64(input.imageBase64),
  );
  const r2Key = imageKey(projectId, jobId, version, id);
  await storeFeaturedImage(r2Key, normalized.bytes);
  if (
    !(await images.begin({
      id,
      projectId,
      jobId,
      artifactVersion: version,
      status: "ready",
      source: input.source,
      r2Key,
      sourceUrl: input.sourceUrl ?? null,
      rightsNote: input.rightsNote.trim(),
      visualBrief: input.visualBrief.trim() || input.filename,
      altText: input.altText.trim(),
      bytes: normalized.bytes.length,
      actorId,
      createdAt: new Date().toISOString(),
    }))
  )
    throw new AppError("CONFLICT");
  if (!(await images.select(projectId, jobId, version, id, actorId)))
    throw new AppError("CONFLICT");
  return images.image(projectId, id);
}

export async function updateFeaturedAlt(
  projectId: string,
  jobId: string,
  version: number,
  imageId: string,
  actorId: string,
  altText: string,
) {
  await currentDraft(projectId, jobId, version);
  const image = await images.image(projectId, imageId);
  if (
    !image ||
    image.jobId !== jobId ||
    image.artifactVersion !== version ||
    image.status !== "ready"
  )
    throw new AppError("CONFLICT");
  if (
    !(await images.select(
      projectId,
      jobId,
      version,
      imageId,
      actorId,
      altText.trim(),
    ))
  )
    throw new AppError("CONFLICT");
  return images.image(projectId, imageId);
}

export async function reuseFeaturedImage(
  projectId: string,
  jobId: string,
  version: number,
  sourceImageId: string,
  actorId: string,
) {
  await currentDraft(projectId, jobId, version);
  const imageId = await images.cloneReadyForVersion(
    projectId,
    jobId,
    sourceImageId,
    version,
    actorId,
  );
  if (!imageId) throw new AppError("CONFLICT");
  if (!(await images.select(projectId, jobId, version, imageId, actorId))) {
    await images.fail(
      projectId,
      imageId,
      "Draft changed before the prior image could be selected.",
    );
    throw new AppError("CONFLICT");
  }
  return images.image(projectId, imageId);
}

export async function featuredImageData(projectId: string, jobId: string) {
  const job = await AutomationRepository.job(projectId, jobId);
  if (!job) throw new AppError("NOT_FOUND");
  const latestAttempt =
    (await images.attempts(projectId, jobId, job.version))[0] ?? null;
  const image = job?.featuredImageId
    ? await images.image(projectId, job.featuredImageId)
    : null;
  if (
    !image ||
    image.jobId !== jobId ||
    image.artifactVersion !== job.version ||
    image.status !== "ready" ||
    !image.r2Key
  )
    return { image: null, base64: null, latestAttempt };
  return {
    image,
    base64: encodeImageBase64(await readFeaturedImage(image.r2Key)),
    latestAttempt,
  };
}
