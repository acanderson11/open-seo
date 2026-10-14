import { generateText, Output } from "ai";
import type { z } from "zod";
import { getChatAgentModel } from "@/server/lib/openrouter";
import { briefResult, type briefRequest } from "@/types/schemas/seoBrief";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { BriefRepository as repo } from "./BriefRepository";
import { collectBriefEvidence } from "./BriefEvidence";
import {
  validateBrief,
  BRIEF_INSTRUCTIONS,
  BRIEF_REPAIR_INSTRUCTIONS,
} from "./BriefRules";
import { contextSnapshot } from "./AutomationService";
import { AppError } from "@/server/lib/errors";
export async function investigateBrief(
  projectId: string,
  actorId: string,
  input: z.infer<typeof briefRequest>,
  billing: BillingCustomerContext,
) {
  const existing = await repo.byRequest(projectId, input.requestKey);
  if (existing) {
    if (
      existing.topic !== input.topic ||
      existing.includeSerp !== Number(input.includeSerp)
    )
      throw new AppError("CONFLICT");
    return existing;
  }
  if ((await repo.countToday(projectId)) >= 20)
    throw new AppError("RATE_LIMITED");
  const row = await repo.reserve({
    id: crypto.randomUUID(),
    projectId,
    actorId,
    requestKey: input.requestKey,
    topic: input.topic,
    includeSerp: Number(input.includeSerp),
    slot: "generation",
    state: "running",
    createdAt: new Date().toISOString(),
  });
  if (!row) {
    const replay = await repo.byRequest(projectId, input.requestKey);
    if (
      replay &&
      replay.topic === input.topic &&
      replay.includeSerp === Number(input.includeSerp)
    )
      return replay;
    throw new AppError("CONFLICT");
  }
  let stage:
    | "evidence"
    | "configuration"
    | "model"
    | "citations"
    | "context"
    | "save" = "evidence";
  let modelSignal: AbortSignal | undefined;
  let citationFailureReason: string | null = null;
  try {
    const packet = await collectBriefEvidence(
      projectId,
      input.topic,
      input.includeSerp,
      billing,
    );
    stage = "configuration";
    const model = await getChatAgentModel();
    stage = "model";
    modelSignal = AbortSignal.timeout(90000);
    const response = await generateText({
      model,
      system: BRIEF_INSTRUCTIONS,
      prompt: JSON.stringify({
        topic: input.topic,
        evidence: packet.sources,
        limitations: packet.warnings,
      }),
      output: Output.object({ schema: briefResult }),
      // Briefs are bounded evidence summaries; avoid inheriting SAM's maximum reasoning budget.
      providerOptions: { openrouter: { reasoning: { effort: "low" } } },
      maxOutputTokens: 8000,
      maxRetries: 0,
      abortSignal: modelSignal,
    });
    stage = "citations";
    let result;
    try {
      result = validateBrief(
        response.output,
        packet.sources,
        packet.coverageIncomplete,
        packet.warnings,
      );
    } catch (error) {
      if (!(error instanceof AppError) || !error.details?.briefCitationReason)
        throw error;
      citationFailureReason = error.details.briefCitationReason;
      const repaired = await generateText({
        model,
        system: BRIEF_REPAIR_INSTRUCTIONS,
        prompt: JSON.stringify({
          topic: input.topic,
          evidence: packet.sources,
          proposedBrief: response.output,
          failedCheck: citationFailureReason,
        }),
        output: Output.object({ schema: briefResult }),
        providerOptions: { openrouter: { reasoning: { effort: "low" } } },
        maxOutputTokens: 8000,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(90000),
      });
      result = validateBrief(
        repaired.output,
        packet.sources,
        packet.coverageIncomplete,
        packet.warnings,
      );
    }
    stage = "context";
    const current = await contextSnapshot(projectId);
    const stale = current.version !== packet.contextVersion;
    const sections = [
      ...result.findings.map((f) => ({
        kind: "finding",
        heading: null,
        detail: f.detail,
        evidenceId: f.evidenceId,
        quote: f.quote,
      })),
      ...result.outline.map((o) => ({
        kind: "outline",
        heading: o.heading,
        detail: o.detail,
        evidenceId: null,
        quote: null,
      })),
      ...result.gaps.map((detail) => ({
        kind: "gap",
        heading: null,
        detail,
        evidenceId: null,
        quote: null,
      })),
      ...result.expertQuestions.map((detail) => ({
        kind: "expert_question",
        heading: null,
        detail,
        evidenceId: null,
        quote: null,
      })),
    ];
    stage = "save";
    await repo.finish(
      projectId,
      row.id,
      {
        state: "saved",
        message: stale
          ? "Project context changed during investigation. Review against current guidance before using this brief."
          : "AI proposal saved for agency review. This does not authorize writing or publication.",
        contextVersion: packet.contextVersion,
        evidenceVersion: packet.evidenceVersion,
        contextText: packet.contextText,
        model: model.modelId,
        title: result.title,
        action: result.action,
        targetUrl: result.targetUrl,
        audience: result.audience,
        intent: result.intent,
        angle: result.angle,
        rationale: result.rationale,
        successMeasure: result.successMeasure,
        confidence: result.confidence,
      },
      packet.sources.map((s) => ({ ...s, briefId: row.id })),
      sections.map((s, position) => ({
        ...s,
        id: crypto.randomUUID(),
        briefId: row.id,
        position,
      })),
    );
  } catch (error) {
    if (stage === "citations" && error instanceof AppError)
      citationFailureReason =
        error.details?.briefCitationReason ?? citationFailureReason;
    // Fixed stage-specific messages never include private provider errors or prompt data.
    const message =
      stage === "model" && modelSignal?.aborted
        ? "The AI model exceeded the 90-second response limit. No brief was saved. Review model settings before starting a new investigation."
        : {
            evidence:
              "Could not gather the project evidence. Check project context and connected data before retrying.",
            configuration:
              "Could not load the configured AI model. Check the OpenSEO AI configuration before retrying.",
            model:
              "The AI provider failed or did not return a valid structured brief. No brief was saved. Check model availability and structured-output support.",
            citations: `The AI proposal failed source-citation validation${citationFailureReason ? ` (${citationFailureReason})` : ""}. No brief was saved; unverified findings were not accepted.`,
            context:
              "Could not recheck project guidance after generation. No brief was saved. Check project context before retrying.",
            save: "Could not save the completed brief and its evidence. No completed brief was recorded. Check storage before retrying.",
          }[stage];
    await repo.finish(
      projectId,
      row.id,
      {
        state: "failed",
        message,
      },
      [],
      [],
    );
  }
  return repo.get(projectId, row.id);
}
export async function getSavedBrief(projectId: string, id: string) {
  const brief = await repo.detail(projectId, id);
  if (!brief) throw new AppError("NOT_FOUND");
  const current = await contextSnapshot(projectId).catch(() => null);
  return {
    ...brief,
    contextChanged:
      !!brief.contextVersion && current?.version !== brief.contextVersion,
  };
}
