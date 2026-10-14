import { feedbackFields } from "./contentFeedback";
import { z } from "zod";
export const projectRequest = z.object({ projectId: z.string().min(1) });
export const automationPolicySchema = projectRequest.extend({
  enabled: z.boolean(),
  delivery: z.enum(["manual", "wordpress"]).default("manual"),
  autopilot: z.boolean().optional(),
  monthlyTarget: z.number().int().min(1).max(20).optional(),
  reviewerEmail: z.string().email().max(254).optional(),
  monthlyLimit: z.number().int().min(1).max(100),
  approval: z.enum(["none", "agency", "client", "both"]),
  expectedVersion: z.string().nullable(),
});
export const draftRequestSchema = projectRequest.extend({
  requestKey: z.string().uuid(),
  topic: z.string().trim().min(3).max(500),
  targetUrl: z.string().url().max(1000),
});
export const draftDecisionSchema = projectRequest.extend({
  jobId: z.string().uuid(),
  version: z.number().int().min(1),
  featuredImageId: z.string().uuid().nullable(),
  feedback: feedbackFields.optional(),
  decision: z.enum(["approved", "changes_requested"]),
});
const prose = z.string().trim().min(1);
const block = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["paragraph", "h2", "h3"]), text: prose.max(4000) }),
  z.object({
    type: z.enum(["ul", "ol"]),
    items: z.array(prose.max(1500)).min(1).max(20),
  }),
]);
export const automationResultSchema = z.object({
  jobId: z.string(),
  projectId: z.string(),
  contextVersion: z.string(),
  policyVersion: z.string(),
  n8nExecutionId: z.string().min(1).max(100),
  artifactVersion: z.number().int().min(1).max(4).default(1),
  publicationPerformed: z.literal(false),
  draft: z.object({
    title: prose.max(180),
    metaDescription: prose.max(320),
    blocks: z.array(block).min(3).max(100),
  }),
  review: z.object({
    pass: z.boolean(),
    issues: z
      .array(
        z.object({
          severity: z.enum(["blocking", "warning"]),
          reason: prose.max(1500),
        }),
      )
      .max(30),
  }),
});
export type AutomationResult = z.infer<typeof automationResultSchema>;

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
export function renderArticle(draft: AutomationResult["draft"]) {
  return draft.blocks
    .map((item) => {
      if ("items" in item)
        return `<${item.type}>${item.items.map((value) => `<li>${escape(value)}</li>`).join("")}</${item.type}>`;
      const tag = item.type === "paragraph" ? "p" : item.type;
      return `<${tag}>${escape(item.text)}</${tag}>`;
    })
    .join("\n");
}
export function draftState(
  qualityPassed: boolean,
  approval: string,
  contextMatches: boolean,
) {
  if (!qualityPassed || !contextMatches) return "needs_revision";
  return approval === "none"
    ? "ready_for_manual_publication"
    : "awaiting_approval";
}
