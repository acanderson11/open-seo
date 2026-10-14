import { z } from "zod";
export const briefRequest = z.object({
  projectId: z.string().min(1),
  requestKey: z.string().uuid(),
  topic: z.string().trim().min(3).max(300),
  includeSerp: z.boolean().default(true),
});
const text = z.string().trim().min(1).max(2000);
export const briefResult = z.object({
  title: z.string().trim().min(3).max(300),
  action: z.enum([
    "improve_existing",
    "create_new",
    "research_first",
    "no_action",
  ]),
  targetEvidenceId: z.string().nullable(),
  audience: text,
  intent: text,
  angle: text,
  rationale: text,
  successMeasure: text,
  confidence: z.enum(["low", "medium"]),
  findings: z
    .array(
      z.object({
        detail: text,
        evidenceId: z.string().min(1),
        quote: z.string().trim().min(8).max(500),
      }),
    )
    .min(1)
    .max(8),
  outline: z
    .array(z.object({ heading: z.string().min(1).max(200), detail: text }))
    .max(10),
  gaps: z.array(text).max(10),
  expertQuestions: z.array(text).max(8),
});
export type BriefResult = z.infer<typeof briefResult>;
export type BriefEvidence = {
  id: string;
  kind: string;
  title: string;
  url: string | null;
  content: string;
  observedAt: string;
};
