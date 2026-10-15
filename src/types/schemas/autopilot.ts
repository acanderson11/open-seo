import { z } from "zod";
export const plannerSelection = z.union([
  z.object({
    action: z.literal("skip"),
    reason: z.string().min(1).max(3000),
  }),
  z.object({
    action: z.literal("draft"),
    topic: z.string().trim().min(3).max(500),
    rationale: z.string().min(1).max(3000),
    evidenceIds: z.array(z.string()).min(1).max(10),
    sourceUrls: z.array(z.string().url()).min(1).max(5),
  }),
]);
export const plannerResult = z.object({
  projectId: z.string(),
  contextVersion: z.string(),
  selection: plannerSelection,
});
export function dueForDraft(target: number, completed: number, now: Date) {
  const days = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return (
    completed < Math.min(target, Math.ceil((now.getUTCDate() * target) / days))
  );
}
export const wordpressSetup = z.object({
  projectId: z.string().min(1),
  baseUrl: z.string().url().max(1000),
  username: z.string().trim().min(1).max(100),
  applicationPassword: z.string().min(10).max(300),
});
