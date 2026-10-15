import { ArticleResearchRepository } from "@/server/features/automation/ArticleResearchRepository";
import {
  listArticleFollowUps,
  retryArticleFollowUp as retryFollowUp,
} from "@/server/features/automation/ArticleFollowUpService";
import { FeaturedImageRepository as featuredImages } from "@/server/features/automation/FeaturedImageRepository";
import { changeArticleLifecycle } from "@/server/features/automation/ArticleLifecycleService";
import { BriefRepository } from "@/server/features/automation/BriefRepository";
import { savePendingFeedback } from "@/server/features/automation/PendingFeedbackService";
import { startQueuedRevision } from "@/server/features/automation/ArticleRevisionService";
import { feedbackFields } from "@/types/schemas/contentFeedback";
import { ContentLearningRepository as learning } from "@/server/features/automation/ContentLearningRepository";
import { AutopilotRepository as auto } from "@/server/features/automation/AutopilotRepository";
import {
  decideDraft,
  reviewOrigin,
} from "@/server/features/automation/DraftReviewService";
import { MANUAL_DELIVERY_STATES } from "@/server/features/automation/ArticleLifecycleRepository";
import { ExecutionTaskRepository as tasksRepo } from "@/server/features/automation/ExecutionTaskRepository";
import {
  createTask,
  updateTask,
  prioritizeDraft,
} from "@/server/features/automation/ExecutionTaskService";
import {
  createTaskSchema,
  updateTaskSchema,
  draftPrioritySchema,
} from "@/types/schemas/executionBoard";
import { z } from "zod";
import { contextSnapshot } from "@/server/features/automation/AutomationService";
import { createServerFn } from "@tanstack/react-start";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import { AutomationRepository as repo } from "@/server/features/automation/AutomationRepository";
import {
  retryDraft,
  startDraft,
} from "@/server/features/automation/AutomationService";
import {
  projectRequest,
  automationPolicySchema,
  draftRequestSchema,
  draftDecisionSchema,
} from "@/types/schemas/automation";
async function authorize(context: { role: string }) {
  requireOrgPermission(context, { integration: ["manage"] });
  if (await isHostedServerAuthMode()) throw new AppError("FORBIDDEN");
}
export const getAutomation = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectRequest)
  .handler(async ({ context }) => {
    await authorize(context);
    const [policy, jobs, tasks] = await Promise.all([
      repo.policy(context.projectId),
      repo.jobs(context.projectId),
      tasksRepo.list(context.projectId),
    ]);
    const followUps = await listArticleFollowUps(
      context.projectId,
      jobs.map((job) => job.id),
    );
    return {
      policy,
      jobs,
      tasks: tasks.slice(0, 500),
      tasksTruncated: tasks.length > 500,
      followUps,
    };
  });
export const saveAutomationPolicy = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(automationPolicySchema)
  .handler(async ({ context, data }) => {
    await authorize(context);
    if (data.enabled && data.autopilot) {
      if (
        !data.reviewerEmail ||
        !["agency", "client"].includes(data.approval) ||
        data.monthlyLimit < (data.monthlyTarget ?? 4) ||
        (data.delivery === "wordpress" &&
          !(await auto.wordpress(context.projectId)))
      )
        throw new AppError("VALIDATION_ERROR");
      await contextSnapshot(context.projectId);
      await reviewOrigin();
    }
    if (!(await repo.savePolicy(context.projectId, data)))
      throw new AppError("CONFLICT");
    return repo.policy(context.projectId);
  });
export const createAutomationDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(draftRequestSchema)
  .handler(async ({ context, data }) => {
    await authorize(context);
    if (!context.project.domain) throw new AppError("VALIDATION_ERROR");
    return startDraft(
      context.projectId,
      context.project.domain,
      context.userId,
      data,
    );
  });
export const decideAutomationDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(draftDecisionSchema)
  .handler(async ({ context, data }) => {
    await authorize(context);
    const job = await decideDraft(
      context.projectId,
      data.jobId,
      context.userId,
      data.decision,
      {
        version: data.version,
        feedback: data.feedback,
        featuredImageId: data.featuredImageId,
      },
    );
    if (data.decision === "changes_requested")
      await startQueuedRevision(context.projectId, data.jobId);
    return job;
  });

const detailRequest = projectRequest.extend({ jobId: z.string().uuid() });
export const retryAutomationDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(detailRequest)
  .handler(async ({ context, data }) => {
    await authorize(context);
    if (!context.project.domain) throw new AppError("VALIDATION_ERROR");
    return retryDraft(context.projectId, context.project.domain, data.jobId);
  });
export const getAutomationDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(detailRequest)
  .handler(async ({ context, data }) => {
    await authorize(context);
    const job = await repo.job(context.projectId, data.jobId);
    if (!job) throw new AppError("NOT_FOUND");
    return {
      ...job,
      researchSources: (
        await ArticleResearchRepository.list(
          context.projectId,
          job.id,
          job.version,
        )
      ).map(({ id, url, title, observedAt }) => ({
        id,
        url,
        title,
        observedAt,
      })),
      contextCurrent:
        (await contextSnapshot(context.projectId)).version ===
        job.contextVersion,
      history: await learning.history(context.projectId, data.jobId),
      imageAttempts: (
        await featuredImages.attempts(
          context.projectId,
          data.jobId,
          job.version,
        )
      ).map(({ id, status, createdAt, failure }) => ({
        id,
        status,
        createdAt,
        failure,
      })),
      researchBrief: await BriefRepository.detail(
        context.projectId,
        job.requestKey,
      ),
      approvalRole: (await repo.policy(context.projectId))?.approval,
    };
  });
export const exportAutomationDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(detailRequest)
  .handler(async ({ context, data }) => {
    await authorize(context);
    const job = await repo.job(context.projectId, data.jobId);
    if (!job) throw new AppError("NOT_FOUND");
    // The approved version is exportable even if Context or settings changed since.
    if (
      !MANUAL_DELIVERY_STATES.includes(job.state) ||
      job.wordpressPostId ||
      !job.bodyHtml ||
      !job.qualityPassed
    )
      throw new AppError("CONFLICT");
    return {
      bodyHtml: job.bodyHtml,
      title: job.title,
      metaDescription: job.metaDescription,
    };
  });

export const createExecutionTask = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(createTaskSchema)
  .handler(async ({ context, data }) => {
    await authorize(context);
    return createTask(context.projectId, context.userId, data);
  });
export const updateExecutionTask = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateTaskSchema)
  .handler(async ({ context, data }) => {
    await authorize(context);
    return updateTask(context.projectId, data);
  });
export const prioritizeExecutionDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(draftPrioritySchema)
  .handler(async ({ context, data }) => {
    await authorize(context);
    return prioritizeDraft(context.projectId, data);
  });
export const getAutomationSettings = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectRequest)
  .handler(async ({ context }) => {
    await authorize(context);
    const connection = await auto.wordpress(context.projectId);
    let reviewReady = false;
    try {
      await reviewOrigin();
      reviewReady = true;
    } catch {}
    return {
      policy: await repo.policy(context.projectId),
      wordpress: connection
        ? {
            baseUrl: connection.baseUrl,
            username: connection.username,
            version: connection.version,
          }
        : null,
      stats: await auto.stats(
        context.projectId,
        new Date().toISOString().slice(0, 7),
      ),
      reviewReady,
    };
  });

export const getContentGuidelines = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectRequest)
  .handler(async ({ context }) => {
    await authorize(context);
    return learning.guidelines(context.projectId);
  });
export const setContentGuideline = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectRequest.extend({
      id: z.string().uuid(),
      version: z.number().int().positive(),
      status: z.enum(["active", "disabled"]),
    }),
  )
  .handler(async ({ context, data }) => {
    await authorize(context);
    if (
      !(await learning.setStatus(
        context.projectId,
        data.id,
        data.version,
        data.status,
        context.userId,
      ))
    )
      throw new AppError("CONFLICT");
    return { saved: true };
  });

export const updatePendingArticleFeedback = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    detailRequest.extend({
      version: z.number().int().positive(),
      feedbackId: z.string().uuid(),
      expectedToken: z.string().uuid().nullable(),
      queueRevision: z.boolean().default(false),
      feedback: feedbackFields,
    }),
  )
  .handler(async ({ context, data }) => {
    await authorize(context);
    const result = await savePendingFeedback(context.projectId, data);
    if (data.queueRevision)
      await startQueuedRevision(context.projectId, data.jobId);
    return result;
  });

export const changeAutomationArticle = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    detailRequest.extend({
      version: z.number().int().positive(),
      action: z.enum(["reopen", "published", "remove"]),
      publishedUrl: z.string().url().max(1000).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    await authorize(context);
    return changeArticleLifecycle(context.projectId, context.userId, data);
  });

export const retryArticleFollowUp = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectRequest.extend({ id: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    await authorize(context);
    if (!(await retryFollowUp(context.projectId, data.id)))
      throw new AppError(
        "CONFLICT",
        "This follow-up is no longer available for retry.",
      );
    return { saved: true };
  });
