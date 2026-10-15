import { z } from "zod";
export const TASK_CATEGORIES = {
  technical: "Technical SEO",
  content: "Content",
  local: "Local SEO",
  backlinks: "Backlinks",
  analytics: "Analytics",
  general: "Other",
} as const;
export const TASK_PRIORITIES = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
} as const;
export const BOARD_STAGES = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  review: "Review",
  ready: "Ready",
  done: "Done",
} as const;
export const categorySchema = z.enum([
  "technical",
  "content",
  "local",
  "backlinks",
  "analytics",
  "general",
]);
export const prioritySchema = z.enum(["critical", "high", "normal", "low"]);
export const stageSchema = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "review",
  "ready",
  "done",
]);
export type TaskCategory = z.infer<typeof categorySchema>;
export type TaskPriority = z.infer<typeof prioritySchema>;
export type BoardStage = z.infer<typeof stageSchema>;
export const taskFieldsSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().max(4000),
  category: categorySchema,
  priority: prioritySchema,
  state: stageSchema,
});
export const createTaskSchema = taskFieldsSchema.extend({
  projectId: z.string().min(1),
  requestKey: z.string().uuid(),
});
export const updateTaskSchema = taskFieldsSchema.extend({
  projectId: z.string().min(1),
  id: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
});
export const draftPrioritySchema = z.object({
  projectId: z.string().min(1),
  jobId: z.string().uuid(),
  priority: prioritySchema,
  expectedPriority: prioritySchema,
});
export const priorityRank: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};
/**
 * Blocked and review states an agency can remove from the board. Excludes
 * publication_unknown: a WordPress post may exist, so it needs reconciling.
 */
export const REMOVABLE_DRAFT_STATES = [
  "held",
  "failed",
  "publication_blocked",
  "awaiting_approval",
  "needs_revision",
  "draft_ready",
];
// Workflow stages are projections, not writable approval/publication state.
export function draftBoardStage(state: string): BoardStage {
  if (
    [
      "preparing",
      "running",
      "publishing",
      "revision_queued",
      "revising",
    ].includes(state)
  )
    return "in_progress";
  if (
    ["held", "failed", "publication_unknown", "publication_blocked"].includes(
      state,
    )
  )
    return "blocked";
  if (["awaiting_approval", "needs_revision", "draft_ready"].includes(state))
    return "review";
  if (["ready_for_manual_publication", "ready_to_publish"].includes(state))
    return "ready";
  if (state === "published") return "done";
  return "todo";
}
