import { articlePassages, revisionMessage } from "./articlePassages";
import { z } from "zod";
export const feedbackFields = z.object({
  passages: z
    .array(
      z.object({
        blockIndex: z.number().int().min(0),
        quote: z.string().min(1).max(1200),
        message: z.string().trim().min(1).max(1500),
      }),
    )
    .max(20)
    .optional(),
  message: z.string().trim().max(4000).default(""),
  scope: z.enum(["article", "preference", "fact"]).default("article"),
  category: z
    .enum(["voice", "structure", "terminology", "facts"])
    .default("voice"),
  instruction: z.string().trim().max(1000).default(""),
});
export type ContentFeedback = z.infer<typeof feedbackFields>;
export function validateFeedback(
  decision: string,
  input: ContentFeedback,
  bodyHtml?: string,
) {
  const value = feedbackFields.parse(input);
  if (
    decision === "changes_requested" &&
    !value.message &&
    !value.passages?.length
  )
    throw new Error("Explain the changes you need.");
  if (
    decision !== "changes_requested" &&
    (value.message || value.instruction || value.passages?.length)
  )
    throw new Error("Request a revision to submit feedback.");
  if (value.scope !== "article" && !value.instruction)
    throw new Error("Add the lasting instruction or factual correction.");
  if (value.scope === "preference" && value.category === "facts")
    throw new Error("Facts require verification.");
  if (revisionMessage(value.message, value.passages).length > 4000)
    throw new Error(
      "Keep the combined feedback and quoted passages under 4,000 characters.",
    );
  if (value.passages?.length) {
    const blocks = articlePassages(bodyHtml ?? "");
    if (
      new Set(value.passages.map((p) => p.blockIndex)).size !==
        value.passages.length ||
      value.passages.some((p) => blocks[p.blockIndex]?.quote !== p.quote)
    )
      throw new Error("The article changed. Refresh before commenting.");
  }
  return value;
}
