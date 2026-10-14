import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { executionTasks, automationJobs } from "@/db/schema";
import type { TaskPriority } from "@/types/schemas/executionBoard";
export const ExecutionTaskRepository = {
  async list(projectId: string) {
    return db
      .select()
      .from(executionTasks)
      .where(eq(executionTasks.projectId, projectId))
      .orderBy(desc(executionTasks.createdAt))
      .limit(501);
  },
  async create(values: typeof executionTasks.$inferInsert) {
    return (
      (
        await db
          .insert(executionTasks)
          .values(values)
          .onConflictDoNothing()
          .returning()
      )[0] ?? null
    );
  },
  async byRequest(projectId: string, requestKey: string) {
    return (
      (
        await db
          .select()
          .from(executionTasks)
          .where(
            and(
              eq(executionTasks.projectId, projectId),
              eq(executionTasks.requestKey, requestKey),
            ),
          )
      )[0] ?? null
    );
  },
  async update(
    projectId: string,
    id: string,
    expectedVersion: number,
    fields: Pick<
      typeof executionTasks.$inferInsert,
      "title" | "description" | "category" | "priority" | "state"
    >,
  ) {
    return (
      (
        await db
          .update(executionTasks)
          .set({
            ...fields,
            version: expectedVersion + 1,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(executionTasks.id, id),
              eq(executionTasks.projectId, projectId),
              eq(executionTasks.version, expectedVersion),
            ),
          )
          .returning()
      )[0] ?? null
    );
  },
  async prioritizeDraft(
    projectId: string,
    jobId: string,
    priority: TaskPriority,
    expectedPriority: TaskPriority,
  ) {
    return (
      (
        await db
          .update(automationJobs)
          .set({ priority })
          .where(
            and(
              eq(automationJobs.id, jobId),
              eq(automationJobs.projectId, projectId),
              eq(automationJobs.priority, expectedPriority),
            ),
          )
          .returning()
      ).length === 1
    );
  },
};
