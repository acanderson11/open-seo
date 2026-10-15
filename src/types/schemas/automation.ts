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
  approval: z.enum(["agency", "client"]),
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
const block = z.union([
  z.object({ type: z.enum(["paragraph", "h2", "h3"]), text: prose.max(4000) }),
  z.object({
    type: z.enum(["ul", "ol"]),
    items: z.array(prose.max(1500)).min(1).max(20),
  }),
]);
export const articleDraftSchema = z.object({
  title: prose.max(180),
  metaDescription: prose.max(320),
  // Gemini rejects maxItems on an array of union items with a bare
  // "invalid argument" (HTTP 400), so the cap is a refinement, which stays
  // out of the JSON Schema sent to the model.
  blocks: z
    .array(block)
    .min(3)
    .refine((blocks) => blocks.length <= 100, "At most 100 blocks"),
});
export type ArticleDraft = z.infer<typeof articleDraftSchema>;
export const articleReviewSchema = z.object({
  pass: z.boolean(),
  issues: z
    .array(
      z.object({
        severity: z.enum(["blocking", "warning"]),
        reason: prose.max(1500),
      }),
    )
    .max(30),
});
export type ArticleReview = z.infer<typeof articleReviewSchema>;
/** Brief claims must quote their source word for word; see ArticleGenerationService. */
export const articleBriefSchema = z.object({
  title: prose.max(180),
  angle: prose.max(2000),
  outline: z.array(prose.max(500)).min(1).max(12),
  claims: z
    .array(
      z.object({
        statement: prose.max(1000),
        sourceId: prose.max(100),
        evidence: prose.max(1000),
      }),
    )
    .max(30),
});
export type ArticleBrief = z.infer<typeof articleBriefSchema>;
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
export function renderArticle(draft: ArticleDraft) {
  return draft.blocks
    .map((item) => {
      if ("items" in item)
        return `<${item.type}>${item.items.map((value) => `<li>${escape(value)}</li>`).join("")}</${item.type}>`;
      const tag = item.type === "paragraph" ? "p" : item.type;
      return `<${tag}>${escape(item.text)}</${tag}>`;
    })
    .join("\n");
}
/** A draft and at most three revisions of it; feedback on the last one needs the agency. */
export const MAX_ARTICLE_VERSION = 4;
