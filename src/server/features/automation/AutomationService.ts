import { boundedResult } from "./AutomationResult";
import { researchArticle, RESEARCH_GUIDANCE } from "./ArticleResearchService";
import { ContentLearningRepository as learning } from "./ContentLearningRepository";
import type { z } from "zod";
import { AutomationRepository as repo } from "./AutomationRepository";
import { ProjectContextService } from "@/server/features/project-context/services/ProjectContextService";
import { readPages } from "@/server/lib/scrape";
import { AppError } from "@/server/lib/errors";
import { prepareFeaturedImage } from "./FeaturedImageService";
import { executionHookRequest, executionSecret } from "./n8nExecution";
import { requestReview } from "./DraftReviewService";
import { contentEngine, startGeneration } from "./ArticleGenerationStart";
import type { GenerationJob, PlannedDraft } from "./ArticleGenerationInput";
import {
  renderArticle,
  type ArticleDraft,
  type ArticleReview,
  type draftRequestSchema,
} from "@/types/schemas/automation";
export async function contextSnapshot(projectId: string) {
  const context = await ProjectContextService.getProjectContext(projectId);
  if (
    !context.sections.some(
      (section) =>
        section.key === "business_overview" && section.content.trim(),
    )
  )
    throw new AppError("VALIDATION_ERROR");
  // SAM/MCP's native renderer; no second profile or questionnaire fetch.
  let rendered = ProjectContextService.renderProjectContextMarkdown({
    ...context,
    researchLog: [],
  });
  const rules = await learning.active(projectId);
  if (rules.length > 30)
    throw new AppError(
      "VALIDATION_ERROR",
      "Review and consolidate the project guidelines before generating more content.",
    );
  if (rules.length)
    rendered +=
      "\n\n## Learned writing guidance\n" +
      rules
        .map((rule) => rule.id + " v" + rule.version + ": " + rule.instruction)
        .join("\n");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rendered),
  );
  return {
    rendered,
    version: Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
  };
}
const host = (value: string) => value.toLowerCase().replace(/^www\./, "");
export function validateTarget(target: string, domain: string) {
  const url = new URL(target),
    site = new URL(/^https?:\/\//i.test(domain) ? domain : `https://${domain}`);

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    host(url.hostname) !== host(site.hostname) ||
    (url.port && url.port !== "443")
  )
    throw new AppError("VALIDATION_ERROR");
  return url.href;
}
export async function startDraft(
  projectId: string,
  domain: string,
  actorId: string,
  input: z.infer<typeof draftRequestSchema>,
  planned?: PlannedDraft,
) {
  const targetUrl = validateTarget(input.targetUrl, domain);
  const existing = await repo.byRequest(projectId, input.requestKey);
  if (existing) {
    if (existing.topic !== input.topic || existing.targetUrl !== targetUrl)
      throw new AppError("CONFLICT");
    return existing;
  }
  const engine = await contentEngine();
  if (engine === "n8n") await executionSecret();
  const policy = await repo.policy(projectId);
  if (!policy?.enabled) throw new AppError("FORBIDDEN");
  const snapshot = await contextSnapshot(projectId);
  if (
    planned?.savedBrief &&
    planned.savedBrief.contextVersion !== snapshot.version
  )
    throw new AppError("CONFLICT");
  const id = crypto.randomUUID(),
    createdAt = new Date().toISOString();
  if (
    !(await repo.create({
      id,
      projectId,
      requestKey: input.requestKey,
      topic: input.topic,
      targetUrl,
      actorId,
      state: "queued",
      contextVersion: snapshot.version,
      policyVersion: policy.version,
      createdAt,
      version: 1,
      kind: draftKind(planned),
      rationale: planned?.rationale,
    }))
  )
    return repo.byRequest(projectId, input.requestKey);
  if (
    !(await repo.reserve(projectId, id, policy.version, createdAt.slice(0, 7)))
  ) {
    await repo.update(projectId, id, {
      state: "held",
      message:
        "Paused, monthly allowance reached, policy changed, or another job is still running.",
    });
    return repo.job(projectId, id);
  }
  if (engine === "app")
    await startGeneration({
      projectId,
      jobId: id,
      version: 1,
      domain,
      topic: input.topic,
      targetUrl,
      planned,
    });
  else await runN8nDraft({ projectId, domain, input, planned, id, targetUrl });
  return repo.job(projectId, id);
}

/** Collects the sources and Context for a new draft. Runs before any paid model call. */
export async function buildDraftJob(draft: {
  projectId: string;
  jobId: string;
  requestKey: string;
  topic: string;
  domain: string;
  targetUrl: string;
  planned: PlannedDraft | undefined;
}): Promise<GenerationJob> {
  const { projectId, jobId, planned } = draft;
  const policy = await repo.policy(projectId);
  if (!policy?.enabled) throw new AppError("CONFLICT");
  const snapshot = await contextSnapshot(projectId);
  const source = await draftSources(planned, draft.domain, draft.targetUrl);
  if (!source.pages.length) throw new AppError("UPSTREAM_UNAVAILABLE");
  const externalSources = await researchArticle(
    projectId,
    jobId,
    1,
    draft.topic,
  );
  await repo.update(projectId, jobId, {
    contextVersion: snapshot.version,
    policyVersion: policy.version,
  });
  return {
    contextVersion: snapshot.version,
    policyVersion: policy.version,
    context:
      snapshot.rendered +
      "\n\n" +
      RESEARCH_GUIDANCE +
      (planned?.savedBrief
        ? "\n\n## Saved brief guidance (not factual evidence)\n" +
          planned.savedBrief.guidance
        : ""),
    ...(planned?.savedBrief ? { savedBrief: planned.savedBrief.brief } : {}),
    opportunity: draftOpportunity(draft),
    sources: [
      ...(
        planned?.savedBrief?.sources ??
        source.pages.map((page, index) => ({
          id: `page-${index + 1}`,
          url: page.url,
          text: page.text,
        }))
      ).slice(0, 8),
      ...externalSources,
    ],
  };
}

/** The n8n engine: one blocking webhook call that runs every stage remotely. */
async function runN8nDraft({
  projectId,
  domain,
  input,
  planned,
  id,
  targetUrl,
}: {
  projectId: string;
  domain: string;
  input: z.infer<typeof draftRequestSchema>;
  planned: PlannedDraft | undefined;
  id: string;
  targetUrl: string;
}) {
  let dispatched = false;
  try {
    await repo.update(projectId, id, { state: "preparing", message: null });
    const job = await buildDraftJob({
      projectId,
      jobId: id,
      requestKey: input.requestKey,
      topic: input.topic,
      domain,
      targetUrl,
      planned,
    });
    const request = await executionHookRequest("openseo-content-job", {
      ...job,
      jobId: id,
      projectId,
      feedback: [],
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
        approval: (await repo.policy(projectId))?.approval,
        publication: "manual",
      },
    });
    await repo.update(projectId, id, { state: "running" });
    dispatched = true;
    const result = await boundedResult(await fetch(request));
    if (
      result.jobId !== id ||
      result.projectId !== projectId ||
      result.contextVersion !== job.contextVersion ||
      result.policyVersion !== job.policyVersion
    )
      throw new AppError("CONFLICT");
    await saveDraft(projectId, id, {
      draft: result.draft,
      review: result.review,
      executionId: result.n8nExecutionId,
    });
  } catch (error) {
    console.error("automation.draft failed:", error, {
      projectId,
      jobId: id,
      dispatched,
    });
    if (dispatched)
      await repo.update(projectId, id, {
        state: "outcome_unknown",
        message:
          "The remote outcome could not be verified. Inspect n8n before any retry; this project's slot remains reserved.",
      });
    else
      await failDraft(
        projectId,
        id,
        "Preparation failed before dispatch. Check Context and the source page.",
      );
  }
}

/** Stores a generated first draft, adds its image, frees the slot, and requests review. */
export async function saveDraft(
  projectId: string,
  id: string,
  result: { draft: ArticleDraft; review: ArticleReview; executionId: string },
) {
  const { draft, review } = result;
  const passed =
    review.pass &&
    !review.issues.some((issue) => issue.severity === "blocking");
  await repo.update(projectId, id, {
    state: passed ? "awaiting_approval" : "needs_revision",
    title: draft.title,
    metaDescription: draft.metaDescription,
    bodyHtml: renderArticle(draft),
    message: null,
    review: review.issues
      .map((issue) => `${issue.severity}: ${issue.reason}`)
      .join("\n"),
    qualityPassed: passed ? 1 : 0,
    n8nExecutionId: result.executionId,
    completedAt: new Date().toISOString(),
  });
  await prepareDraftImage(projectId, id);
  await repo.releaseSlot(projectId, id);
  if (passed) await requestReview(projectId, id);
}

/** Marks a first draft failed and frees the project's slot. */
export async function failDraft(
  projectId: string,
  id: string,
  message: string,
  refundUnused = false,
) {
  await repo.update(projectId, id, { state: "failed", message });
  await repo.releaseSlot(projectId, id, refundUnused);
}

async function prepareDraftImage(projectId: string, id: string) {
  try {
    await prepareFeaturedImage(
      { projectId, jobId: id, version: 1 },
      "system:image",
    );
  } catch (error) {
    // The article stays deliverable without an image.
    console.error("automation.draft-image failed:", error, {
      projectId,
      jobId: id,
    });
  }
}

const draftKind = (planned: PlannedDraft | undefined) =>
  planned?.kind ?? (planned ? "new_content" : "refresh_content");

async function draftSources(
  planned: PlannedDraft | undefined,
  domain: string,
  targetUrl: string,
) {
  if (planned?.savedBrief) return { pages: planned.savedBrief.sources };
  return readPages(
    planned?.sourceUrls.map((url) => validateTarget(url, domain)) ?? [
      targetUrl,
    ],
    planned ? 5 : 1,
  );
}
function draftOpportunity(draft: {
  requestKey: string;
  topic: string;
  targetUrl: string;
  planned: PlannedDraft | undefined;
}) {
  const kind = draftKind(draft.planned);
  return {
    id: draft.requestKey,
    kind,
    topic: draft.topic,
    intent:
      kind === "new_content"
        ? "Write a distinct useful article from the saved outline and project goals. Do not duplicate existing pages."
        : "Improve the existing page while preserving its intent.",
    rationale:
      draft.planned?.rationale ??
      "Agency-selected existing-page opportunity in OpenSEO.",
    targetUrl: kind === "new_content" ? null : draft.targetUrl,
  };
}
