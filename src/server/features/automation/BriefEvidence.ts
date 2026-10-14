import { researchPublicSources } from "./ArticleResearchService";
import { sort } from "remeda";
import { getWorkPlan } from "./WorkPlanningService";
import { contextSnapshot } from "./AutomationService";
import {
  needsInventoryRead,
  topicOverlap,
  evidenceHash,
} from "./InventoryRules";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import type { BriefEvidence } from "@/types/schemas/seoBrief";
import { AppError } from "@/server/lib/errors";
export async function collectBriefEvidence(
  projectId: string,
  topic: string,
  includeSerp: boolean,
  billing: BillingCustomerContext,
) {
  const [plan, context, project] = await Promise.all([
    getWorkPlan(projectId),
    contextSnapshot(projectId),
    ProjectRepository.getProjectById(projectId),
  ]);
  if (!project) throw new AppError("NOT_FOUND");
  if (context.rendered.length > 60000) throw new AppError("VALIDATION_ERROR");
  const now = new Date().toISOString(),
    sources: BriefEvidence[] = [];
  const add = (
    kind: string,
    title: string,
    content: string,
    url: string | null = null,
    observedAt = now,
  ) =>
    sources.push({
      id: "e" + sources.length,
      kind,
      title,
      content,
      url,
      observedAt,
    });
  const warnings: string[] = [];
  add(
    "project",
    "Project context and active feedback guidelines",
    context.rendered,
  );
  const current = plan.inventory.pages.filter(
    (p) => p.readState === "read" && !needsInventoryRead(p),
  );
  const coverageIncomplete =
    plan.inventory.limited ||
    current.length < plan.inventory.pages.length ||
    !current.length;
  add(
    "inventory",
    "Known website coverage",
    `Known pages: ${plan.inventory.pages.length}. Current successful reads: ${current.length}. Coverage incomplete: ${coverageIncomplete}. URLs (first 100):\n` +
      plan.inventory.pages
        .slice(0, 100)
        .map(
          (p) =>
            `${p.url} | ${p.title} | ${p.readState} | ${p.readFailure ?? ""}`,
        )
        .join("\n"),
  );
  for (const p of sort(
    current,
    (a, b) => topicOverlap(topic, b) - topicOverlap(topic, a),
  ).slice(0, 8))
    add(
      "page",
      p.title || p.url,
      `Title: ${p.title}\nHeading: ${p.heading}\nDescription: ${p.description}\nExcerpt: ${p.excerpt}`,
      p.url,
      p.contentAt ?? now,
    );
  if (coverageIncomplete)
    warnings.push(
      "Website coverage is incomplete. A missing topic match is not a verified content gap; new-content recommendations require further investigation.",
    );
  if (plan.search.available) {
    const rows = sort(
      plan.search.rows,
      (a, b) => b.impressions - a.impressions,
    ).slice(0, 40);
    add(
      "gsc",
      "Google Search Console query/page performance",
      `Period: ${plan.search.startDate} to ${plan.search.endDate}. Up to 40 of ${plan.search.rows.length} returned rows, sorted by impressions; not a complete keyword census.\n` +
        rows
          .map(
            (r) =>
              `${r.query} | ${r.page} | clicks=${r.clicks} impressions=${r.impressions} averagePosition=${r.position}`,
          )
          .join("\n"),
    );
  } else warnings.push("Search Console evidence is unavailable.");
  if (plan.conversions.available)
    add(
      "ga4",
      "Google Analytics opportunity evidence",
      JSON.stringify({
        period: plan.conversions.request,
        metric: plan.conversions.metric,
        limited: plan.conversions.limited,
        warnings: plan.conversions.warnings,
        rows: plan.conversions.rows.slice(0, 20),
      }),
    );
  else
    warnings.push(
      "GA4 opportunity evidence is unavailable; do not infer zero conversions.",
    );
  if (plan.conversions.available && plan.conversions.metric !== "keyEvents")
    warnings.push(
      "Business value is not confirmed by qualified-lead or revenue measurement. Engagement is not a conversion.",
    );
  add(
    "tasks",
    "Existing execution work",
    plan.activeTasks.map((t) => `${t.title} | ${t.state}`).join("\n") ||
      "No active tasks returned.",
  );
  if (includeSerp) {
    try {
      const rows = await createDataforseoClient(billing).serp.live({
        keyword: topic,
        locationCode: project.locationCode,
        languageCode: project.languageCode,
        depth: 10,
      });
      for (const row of rows.filter((r) => r.type === "organic").slice(0, 10)) {
        const url = safeResultUrl(row.url);
        add(
          "serp",
          (row.title ?? "Google search result").slice(0, 500),
          `Query: ${topic} | location=${project.locationCode} language=${project.languageCode} | rank=${row.rank_absolute ?? row.rank_group ?? "unknown"}\nTitle: ${row.title ?? ""}\nSnippet: ${(row.description ?? "").slice(0, 1800)}\nSearch-result snippets are intent clues, not verified factual/statistical sources.`,
          url,
        );
      }
      if (!sources.some((s) => s.kind === "serp"))
        warnings.push(
          "The live search returned no usable organic results. Search intent remains provisional.",
        );
    } catch {
      warnings.push(
        "Live Google results were unavailable. Search intent and competitive differentiation still need research.",
      );
    }
  } else
    warnings.push(
      "Live Google results were not requested. Search intent and competitive differentiation still need research.",
    );
  const research = await researchPublicSources(topic, project, billing);
  for (const source of research)
    add(
      "external",
      source.title,
      source.content,
      source.url,
      source.observedAt,
    );
  if (!research.length)
    warnings.push(
      "Outside research was attempted but no readable supporting pages were retrieved. Omit unsupported industry claims; client answers remain optional.",
    );
  return {
    contextVersion: context.version,
    contextText: context.rendered,
    sources,
    warnings,
    coverageIncomplete,
    evidenceVersion: await evidenceHash(JSON.stringify(sources)),
  };
}

function safeResultUrl(raw: string | null | undefined): string | null {
  try {
    const url = new URL(raw ?? "");
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
