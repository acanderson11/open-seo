import type { z } from "zod";
import { ExecutionTaskRepository as repo } from "./ExecutionTaskRepository";
import { AppError } from "@/server/lib/errors";
import type {
  createTaskSchema,
  updateTaskSchema,
  draftPrioritySchema,
} from "@/types/schemas/executionBoard";
export async function createTask(
  projectId: string,
  actorId: string,
  input: z.infer<typeof createTaskSchema>,
) {
  const { title, description, category, priority, state, requestKey } = input;
  const now = new Date().toISOString();
  const row =
    (await repo.create({
      id: crypto.randomUUID(),
      projectId,
      actorId,
      title,
      description,
      category,
      priority,
      state,
      requestKey,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })) ?? (await repo.byRequest(projectId, requestKey));
  if (
    !row ||
    row.title !== title ||
    row.description !== description ||
    row.category !== category ||
    row.priority !== priority ||
    row.state !== state
  )
    throw new AppError("CONFLICT");
  return row;
}
export async function updateTask(
  projectId: string,
  input: z.infer<typeof updateTaskSchema>,
) {
  const { title, description, category, priority, state } = input;
  const row = await repo.update(projectId, input.id, input.expectedVersion, {
    title,
    description,
    category,
    priority,
    state,
  });
  if (!row) throw new AppError("CONFLICT");
  return row;
}
export async function prioritizeDraft(
  projectId: string,
  input: z.infer<typeof draftPrioritySchema>,
) {
  if (
    !(await repo.prioritizeDraft(
      projectId,
      input.jobId,
      input.priority,
      input.expectedPriority,
    ))
  )
    throw new AppError("CONFLICT");
}
