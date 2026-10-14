import { boundedResult } from "./AutomationResult";
export { boundedResult } from "./AutomationResult";
import { researchArticle, RESEARCH_GUIDANCE } from "./ArticleResearchService";
import { ContentLearningRepository as learning } from "./ContentLearningRepository";
import {
  validateFeedback,
  type ContentFeedback,
} from "@/types/schemas/contentFeedback";
import type { z } from "zod";
import { AutomationRepository as repo } from "./AutomationRepository";
import { ProjectContextService } from "@/server/features/project-context/services/ProjectContextService";
import { readPages } from "@/server/lib/scrape";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import { FeaturedImageRepository as featuredImages } from "./FeaturedImageRepository";
import { prepareFeaturedImage } from "./FeaturedImageService";
import {
  draftState,
  renderArticle,
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
  planned?: {
    rationale: string;
    sourceUrls: string[];
    wordpressVersion?: string;
    kind?: "new_content" | "refresh_content";
    savedBrief?: {
      brief: {
        title: string;
        angle: string;
        outline: string[];
        claims: { statement: string; sourceId: string; evidence: string }[];
      };
      sources: { id: string; url: string; text: string }[];
      contextVersion: string;
      guidance: string;
    };
  },
) {
  const targetUrl = validateTarget(input.targetUrl, domain);
  const existing = await repo.byRequest(projectId, input.requestKey);
  if (existing) {
    if (existing.topic !== input.topic || existing.targetUrl !== targetUrl)
      throw new AppError("CONFLICT");
    return existing;
  }
  const secret = await getOptionalEnvValue("AGENCY_N8N_EXECUTION_SECRET");
  if (!secret)
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      "The n8n execution connection is not configured.",
    );
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
      kind: planned?.kind ?? (planned ? "new_content" : "refresh_content"),
      rationale: planned?.rationale,
      wordpressVersion: planned?.wordpressVersion,
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
  return runReservedDraft({
    projectId,
    domain,
    input,
    planned,
    policy,
    snapshot,
    id,
    targetUrl,
    secret,
  });
}
async function runReservedDraft({
  projectId,
  domain,
  input,
  planned,
  policy,
  snapshot,
  id,
  targetUrl,
  secret,
}: {
  projectId: string;
  domain: string;
  input: z.infer<typeof draftRequestSchema>;
  planned: Parameters<typeof startDraft>[4];
  policy: NonNullable<Awaited<ReturnType<typeof repo.policy>>>;
  snapshot: Awaited<ReturnType<typeof contextSnapshot>>;
  id: string;
  targetUrl: string;
  secret: string;
}): Promise<Awaited<ReturnType<typeof repo.job>>> {
  let dispatched = false;
  try {
    await repo.update(projectId, id, { state: "preparing", message: null });
    const source = await draftSources(planned, domain, targetUrl);
    if (!source.pages.length) throw new AppError("UPSTREAM_UNAVAILABLE");
    const externalSources = await researchArticle(
      projectId,
      id,
      1,
      input.topic,
    );
    const freshPolicy = await repo.policy(projectId),
      fresh = await contextSnapshot(projectId);
    if (
      !freshPolicy?.enabled ||
      freshPolicy.version !== policy.version ||
      fresh.version !== snapshot.version
    )
      throw new AppError("CONFLICT");
    const job = {
      jobId: id,
      projectId,
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
        approval: policy.approval,
        publication: "manual",
      },
      opportunity: draftOpportunity(input, planned, targetUrl),
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
    await repo.update(projectId, id, { state: "running" });
    dispatched = true;
    const response = await fetch(
      "https://n8n.andmktg.com/webhook/openseo-content-job",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openseo-execution-secret": secret,
        },
        body: JSON.stringify(job),
        redirect: "manual",
        signal: AbortSignal.timeout(90000),
      },
    );
    if (!response.ok) throw new AppError("UPSTREAM_UNAVAILABLE");
    const result = await boundedResult(response);
    if (
      result.jobId !== id ||
      result.projectId !== projectId ||
      result.contextVersion !== snapshot.version ||
      result.policyVersion !== policy.version
    )
      throw new AppError("CONFLICT");
    const current = await contextSnapshot(projectId),
      currentPolicy = await repo.policy(projectId);
    const passed =
      result.review.pass &&
      !result.review.issues.some((issue) => issue.severity === "blocking");
    const state = draftState(
      passed,
      policy.approval,
      current.version === snapshot.version &&
        currentPolicy?.version === policy.version &&
        currentPolicy.enabled === 1,
    );
    await repo.update(projectId, id, {
      state,
      title: result.draft.title,
      metaDescription: result.draft.metaDescription,
      bodyHtml: renderArticle(result.draft),
      message: null,
      review: result.review.issues
        .map((issue) => `${issue.severity}: ${issue.reason}`)
        .join("\n"),
      qualityPassed: passed ? 1 : 0,
      n8nExecutionId: result.n8nExecutionId,
      completedAt: new Date().toISOString(),
    });
    if (["awaiting_approval", "needs_revision"].includes(state)) {
      try { await prepareFeaturedImage(projectId, id, 1, "system:image"); } catch { /* Article delivery remains available without an image. */ }
    }
    await repo.releaseSlot(projectId, id);
  } catch {
    await repo.update(projectId, id, {
      state: dispatched ? "outcome_unknown" : "failed",
      message: dispatched
        ? "The remote outcome could not be verified. Inspect n8n before any retry; this project's slot remains reserved."
        : "Preparation failed before dispatch. Check Context and the source page.",
    });
    if (!dispatched) await repo.releaseSlot(projectId, id);
  }
  return repo.job(projectId, id);
}
export async function decideDraft(
  projectId: string,
  jobId: string,
  actorId: string,
  decision: "approved" | "changes_requested",
  review: { version: number; feedback?: ContentFeedback; featuredImageId: string | null },
) {
  const { version, feedback, featuredImageId } = review;
  const job = await repo.job(projectId, jobId),
    policy = await repo.policy(projectId);
  if (!job || !policy) throw new AppError("NOT_FOUND");
  if (
    job.version !== version ||
    !(
      decision === "changes_requested"
        ? ["awaiting_approval", "needs_revision"]
        : ["awaiting_approval"]
    ).includes(job.state) ||
    !job.bodyHtml
  )
    throw new AppError("CONFLICT");
  if (job.featuredImageId !== featuredImageId) throw new AppError("CONFLICT");
  if (decision === "approved" && featuredImageId) {
    const image = await featuredImages.image(projectId, featuredImageId);
    if (!image || image.jobId !== jobId || image.artifactVersion !== version || image.status !== "ready" || image.altText.trim().length < 15)
      throw new AppError("CONFLICT");
  }
  const current = await contextSnapshot(projectId);
  if (
    !policy.enabled ||
    policy.version !== job.policyVersion ||
    (decision === "approved" && current.version !== job.contextVersion) ||
    (decision === "approved" && !job.qualityPassed)
  )
    throw new AppError("CONFLICT");
  if (policy.approval !== "agency") throw new AppError("FORBIDDEN");
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
  const nextState =
    decision === "changes_requested"
      ? version >= 4
        ? "needs_revision"
        : "revision_queued"
      : policy.approval === "agency"
        ? "ready_for_manual_publication"
        : "awaiting_approval";
  if (
    !(await repo.approve(projectId, jobId, actorId, decision, {
      state: nextState,
      artifactVersion: version,
      featuredImageId,
      feedback: validated,
    }))
  )
    throw new AppError("CONFLICT");
  // An agency actor can never stand in for client approval.
  return repo.job(projectId, jobId);
}

async function draftSources(
  planned: Parameters<typeof startDraft>[4],
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
function draftOpportunity(
  input: z.infer<typeof draftRequestSchema>,
  planned: Parameters<typeof startDraft>[4],
  targetUrl: string,
) {
  const kind = planned?.kind ?? (planned ? "new_content" : "refresh_content");
  return {
    id: input.requestKey,
    kind,
    topic: input.topic,
    intent:
      kind === "new_content"
        ? "Write a distinct useful article from the saved outline and project goals. Do not duplicate existing pages."
        : "Improve the existing page while preserving its intent.",
    rationale:
      planned?.rationale ??
      "Agency-selected existing-page opportunity in OpenSEO.",
    targetUrl: kind === "new_content" ? null : targetUrl,
  };
}
