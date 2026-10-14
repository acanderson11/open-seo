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
import { requestClientReview } from "./DraftReviewService";
import {
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
type PlannedDraft = {
  rationale: string;
  sourceUrls: string[];
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
};
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
  await executionSecret();
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
  await runReservedDraft({
    projectId,
    domain,
    input,
    planned,
    policy,
    snapshot,
    id,
    targetUrl,
  });
  return repo.job(projectId, id);
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
}: {
  projectId: string;
  domain: string;
  input: z.infer<typeof draftRequestSchema>;
  planned: PlannedDraft | undefined;
  policy: NonNullable<Awaited<ReturnType<typeof repo.policy>>>;
  snapshot: Awaited<ReturnType<typeof contextSnapshot>>;
  id: string;
  targetUrl: string;
}) {
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
    if (!(await repo.policy(projectId))?.enabled)
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
    const request = await executionHookRequest("openseo-content-job", job);
    await repo.update(projectId, id, { state: "running" });
    dispatched = true;
    const result = await boundedResult(await fetch(request));
    if (
      result.jobId !== id ||
      result.projectId !== projectId ||
      result.contextVersion !== snapshot.version ||
      result.policyVersion !== policy.version
    )
      throw new AppError("CONFLICT");
    const passed =
      result.review.pass &&
      !result.review.issues.some((issue) => issue.severity === "blocking");
    await repo.update(projectId, id, {
      state: passed ? "awaiting_approval" : "needs_revision",
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
    await prepareDraftImage(projectId, id);
    await repo.releaseSlot(projectId, id);
    if (passed) await requestClientReview(projectId, id);
  } catch (error) {
    console.error("automation.draft failed:", error, {
      projectId,
      jobId: id,
      dispatched,
    });
    await repo.update(projectId, id, {
      state: dispatched ? "outcome_unknown" : "failed",
      message: dispatched
        ? "The remote outcome could not be verified. Inspect n8n before any retry; this project's slot remains reserved."
        : "Preparation failed before dispatch. Check Context and the source page.",
    });
    if (!dispatched) await repo.releaseSlot(projectId, id);
  }
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
function draftOpportunity(
  input: z.infer<typeof draftRequestSchema>,
  planned: PlannedDraft | undefined,
  targetUrl: string,
) {
  const kind = draftKind(planned);
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
