import { ProjectImageRepository as projectImages } from "@/server/features/automation/ProjectImageRepository";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import { projectRequest } from "@/types/schemas/automation";
import { AutomationRepository } from "@/server/features/automation/AutomationRepository";
import { FeaturedImageRepository as images } from "@/server/features/automation/FeaturedImageRepository";
import {
  featuredImageData,
  prepareFeaturedImage,
  replaceFeaturedImage,
  updateFeaturedAlt,
  uploadProjectImageAsset,
  reuseFeaturedImage,
} from "@/server/features/automation/FeaturedImageService";
import {
  encodeImageBase64,
  readFeaturedImage,
} from "@/server/features/automation/FeaturedImageCodec";

async function authorize(context: { role: string }) {
  requireOrgPermission(context, { integration: ["manage"] });
  if (await isHostedServerAuthMode()) throw new AppError("FORBIDDEN");
}
const detail = projectRequest.extend({
  jobId: z.string().uuid(),
  version: z.number().int().positive(),
});
const upload = z.object({
  filename: z.string().trim().min(1).max(180),
  imageBase64: z.string().min(100).max(16_000_000),
  sourceUrl: z.url().startsWith("https://").max(1000).optional(),
  rightsNote: z.string().trim().min(10).max(1000),
  altText: z.string().trim().min(15).max(300),
});

export const getProjectImageSettings = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectRequest)
  .handler(async ({ context }) => {
    await authorize(context);
    const [preferences, assets] = await Promise.all([
      projectImages.preferences(context.projectId),
      projectImages.assets(context.projectId),
    ]);
    return { preferences, assets };
  });

export const saveProjectImageSettings = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectRequest.extend({
      expectedVersion: z.number().int().positive().nullable(),
      autoGenerate: z.boolean(),
      style: z.string().trim().max(300),
      colors: z.string().trim().max(180),
      reference: z.string().trim().max(300),
      avoid: z.string().trim().max(300),
      guidance: z.string().trim().max(1000),
      preferredAssetId: z.string().uuid().nullable(),
    }),
  )
  .handler(async ({ context, data }) => {
    await authorize(context);
    if (!(await projectImages.savePreferences(context.projectId, data)))
      throw new AppError("CONFLICT");
    return projectImages.preferences(context.projectId);
  });

export const uploadProjectFeaturedAsset = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectRequest.extend(upload.shape))
  .handler(async ({ context, data }) => {
    await authorize(context);
    return uploadProjectImageAsset(context.projectId, context.userId, data);
  });

export const getProjectFeaturedAssetData = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectRequest.extend({ assetId: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    await authorize(context);
    const asset = await projectImages.asset(context.projectId, data.assetId);
    if (!asset) throw new AppError("NOT_FOUND");
    return {
      base64: encodeImageBase64(await readFeaturedImage(asset.r2Key)),
      altText: asset.altText,
    };
  });

export const getArticleFeaturedImage = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectRequest.extend({ jobId: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    await authorize(context);
    return featuredImageData(context.projectId, data.jobId);
  });

export const generateArticleFeaturedImage = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    detail.extend({
      visualBrief: z.string().trim().max(600),
      feedback: z.string().trim().max(500),
      rememberFeedback: z.boolean(),
    }),
  )
  .handler(async ({ context, data }) => {
    await authorize(context);
    return prepareFeaturedImage(
      {
        projectId: context.projectId,
        jobId: data.jobId,
        version: data.version,
      },
      context.userId,
      {
        visualBrief: data.visualBrief,
        feedback: data.feedback,
        rememberFeedback: data.rememberFeedback,
        force: true,
      },
    );
  });

export const replaceArticleFeaturedImage = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    detail.extend(upload.shape).extend({
      source: z.enum(["client", "stock"]),
      visualBrief: z.string().trim().max(600),
    }),
  )
  .handler(async ({ context, data }) => {
    await authorize(context);
    return replaceFeaturedImage(
      context.projectId,
      data.jobId,
      data.version,
      context.userId,
      data,
    );
  });

export const updateArticleFeaturedAlt = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    detail.extend({
      imageId: z.string().uuid(),
      altText: z.string().trim().min(15).max(300),
    }),
  )
  .handler(async ({ context, data }) => {
    await authorize(context);
    return updateFeaturedAlt(
      {
        projectId: context.projectId,
        jobId: data.jobId,
        version: data.version,
      },
      data.imageId,
      context.userId,
      data.altText,
    );
  });

export const abandonArticleFeaturedAttempt = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    detail.extend({
      attemptId: z.string().uuid(),
      confirmedStopped: z.literal(true),
    }),
  )
  .handler(async ({ context, data }) => {
    await authorize(context);
    if (
      !(await images.abandon(
        context.projectId,
        data.jobId,
        data.version,
        data.attemptId,
      ))
    )
      throw new AppError("CONFLICT");
    return { abandoned: true };
  });

export const getPreviousArticleFeaturedImages = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(detail)
  .handler(async ({ context, data }) => {
    await authorize(context);
    const job = await AutomationRepository.job(context.projectId, data.jobId);
    if (!job || job.version !== data.version) throw new AppError("CONFLICT");
    const previous = await images.previousReady(
      context.projectId,
      data.jobId,
      data.version,
    );
    return previous.map((image) => ({
      id: image.id,
      version: image.artifactVersion,
      altText: image.altText,
      source: image.source,
    }));
  });

export const reuseArticleFeaturedImage = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(detail.extend({ sourceImageId: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    await authorize(context);
    return reuseFeaturedImage(
      context.projectId,
      data.jobId,
      data.version,
      data.sourceImageId,
      context.userId,
    );
  });
