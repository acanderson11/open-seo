import { BriefRepository } from "./BriefRepository";
import { AutomationRepository } from "./AutomationRepository";
import {
  contextSnapshot,
  startDraft,
  validateTarget,
} from "./AutomationService";
import { AppError } from "@/server/lib/errors";
export async function draftSavedBrief(
  projectId: string,
  domain: string,
  actorId: string,
  briefId: string,
) {
  const existing = await AutomationRepository.byRequest(projectId, briefId);
  if (existing) return existing;
  const brief = await BriefRepository.detail(projectId, briefId);
  if (!brief || brief.state !== "saved" || brief.action === "no_action")
    throw new AppError("CONFLICT");
  const context = await contextSnapshot(projectId);
  if (
    context.version !== brief.contextVersion ||
    !brief.completedAt ||
    Date.now() - Date.parse(brief.completedAt) > 7 * 86400000
  )
    throw new AppError(
      "CONFLICT",
      "Re-investigate this brief: its context or evidence is stale.",
    );
  const sources = brief.sources
    .filter(
      (s) =>
        s.kind === "page" &&
        s.url &&
        Date.now() - Date.parse(s.observedAt) < 7 * 86400000,
    )
    .slice(0, 8)
    .map((s) => ({
      id: s.id,
      url: validateTarget(s.url!, domain),
      text: s.content.slice(0, 12000),
    }));
  if (!sources.length)
    throw new AppError(
      "VALIDATION_ERROR",
      "The brief needs current website evidence before drafting.",
    );
  const outline = brief.sections
    .filter((s) => s.kind === "outline")
    .map((s) => ((s.heading ?? "") + ": " + s.detail).slice(0, 500));
  if (!outline.length) throw new AppError("VALIDATION_ERROR");
  const claims = brief.sections
    .filter(
      (s) =>
        s.kind === "finding" &&
        s.evidenceId &&
        s.quote &&
        sources.some(
          (source) =>
            source.id === s.evidenceId && source.text.includes(s.quote!),
        ),
    )
    .map((s) => ({
      statement: s.detail.slice(0, 1000),
      sourceId: s.evidenceId!,
      evidence: s.quote!,
    }));
  const gaps = brief.sections
    .filter((s) => ["gap", "expert_question"].includes(s.kind))
    .map((s) => s.detail);
  const planningBrief = {
    title: (brief.title ?? brief.topic).slice(0, 180),
    angle: brief.angle ?? brief.topic,
    outline,
    claims,
  };
  const targetUrl =
    brief.action === "improve_existing" && brief.targetUrl
      ? validateTarget(brief.targetUrl, domain)
      : sources[0].url;
  return startDraft(
    projectId,
    domain,
    actorId,
    { projectId, requestKey: briefId, topic: brief.topic, targetUrl },
    {
      rationale: "Saved brief: " + brief.id + ". " + (brief.rationale ?? ""),
      sourceUrls: sources.map((s) => s.url),
      kind:
        brief.action === "improve_existing" ? "refresh_content" : "new_content",
      savedBrief: {
        brief: planningBrief,
        sources,
        contextVersion: context.version,
        guidance: JSON.stringify({
          audience: brief.audience,
          intent: brief.intent,
          angle: brief.angle,
          gaps,
          instructions:
            "Use this saved outline. Research gaps, analytics limitations, and unanswered questions are optional context, not requirements for drafting or approval. Write a useful article using the evidence available. Do not invent information to fill gaps. Gaps and questions are not verified facts. Omit unsupported statistics and client examples. GSC measures search impressions/clicks; use configured GA4 events for internal CTA clicks and leads. Do not copy search snippets or fabricate experience.",
        }),
      },
    },
  );
}
