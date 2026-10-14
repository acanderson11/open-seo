import { and, eq, desc, asc, lt, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  seoBriefs as briefs,
  seoBriefEvidence as evidence,
  seoBriefItems as items,
} from "@/db/schema";
export const BriefRepository = {
  async list(projectId: string) {
    return db
      .select({
        id: briefs.id,
        topic: briefs.topic,
        title: briefs.title,
        state: briefs.state,
        message: briefs.message,
        action: briefs.action,
        createdAt: briefs.createdAt,
      })
      .from(briefs)
      .where(eq(briefs.projectId, projectId))
      .orderBy(desc(briefs.createdAt))
      .limit(50);
  },
  async get(projectId: string, id: string) {
    return (
      (
        await db
          .select()
          .from(briefs)
          .where(and(eq(briefs.projectId, projectId), eq(briefs.id, id)))
          .limit(1)
      )[0] ?? null
    );
  },
  async byRequest(projectId: string, key: string) {
    return (
      (
        await db
          .select()
          .from(briefs)
          .where(
            and(eq(briefs.projectId, projectId), eq(briefs.requestKey, key)),
          )
          .limit(1)
      )[0] ?? null
    );
  },
  async countToday(projectId: string) {
    return Number(
      (
        await db
          .select({ n: sql<number>`count(*)` })
          .from(briefs)
          .where(
            and(
              eq(briefs.projectId, projectId),
              gte(briefs.createdAt, new Date().toISOString().slice(0, 10)),
            ),
          )
      )[0]?.n ?? 0,
    );
  },
  async reserve(values: typeof briefs.$inferInsert) {
    await db
      .update(briefs)
      .set({
        state: "failed",
        slot: null,
        message:
          "Investigation interrupted. You can start a new investigation.",
      })
      .where(
        and(
          eq(briefs.projectId, values.projectId),
          eq(briefs.state, "running"),
          lt(briefs.createdAt, new Date(Date.now() - 600000).toISOString()),
        ),
      );
    return (
      (
        await db.insert(briefs).values(values).onConflictDoNothing().returning()
      )[0] ?? null
    );
  },
  async detail(projectId: string, id: string) {
    const row = await this.get(projectId, id);
    if (!row) return null;
    const [sources, sections] = await Promise.all([
      db
        .select()
        .from(evidence)
        .where(eq(evidence.briefId, id))
        .orderBy(asc(evidence.id)),
      db
        .select()
        .from(items)
        .where(eq(items.briefId, id))
        .orderBy(asc(items.position)),
    ]);
    return { ...row, sources, sections };
  },
  async finish(
    projectId: string,
    id: string,
    fields: Partial<typeof briefs.$inferInsert>,
    sources: (typeof evidence.$inferInsert)[],
    sections: (typeof items.$inferInsert)[],
  ) {
    const row = await this.get(projectId, id);
    if (!row || row.state !== "running") return;
    // Child inserts select only an owned, still-running parent. A timed-out run cannot overwrite a later state.
    await runBatch((tx) => [
      ...sources.map((source) =>
        tx.insert(evidence).select(
          tx
            .select({
              id: sql`${source.id}`.as("id"),
              briefId: briefs.id,
              kind: sql`${source.kind}`.as("kind"),
              title: sql`${source.title}`.as("title"),
              url: sql`${source.url ?? null}`.as("url"),
              content: sql`${source.content}`.as("content"),
              observedAt: sql`${source.observedAt}`.as("observedAt"),
            })
            .from(briefs)
            .where(
              and(
                eq(briefs.projectId, projectId),
                eq(briefs.id, id),
                eq(briefs.state, "running"),
              ),
            ),
        ),
      ),
      ...sections.map((section) =>
        tx.insert(items).select(
          tx
            .select({
              id: sql`${section.id}`.as("id"),
              briefId: briefs.id,
              kind: sql`${section.kind}`.as("kind"),
              position: sql`${section.position}`.as("position"),
              heading: sql`${section.heading ?? null}`.as("heading"),
              detail: sql`${section.detail}`.as("detail"),
              evidenceId: sql`${section.evidenceId ?? null}`.as("evidenceId"),
              quote: sql`${section.quote ?? null}`.as("quote"),
            })
            .from(briefs)
            .where(
              and(
                eq(briefs.projectId, projectId),
                eq(briefs.id, id),
                eq(briefs.state, "running"),
              ),
            ),
        ),
      ),
      tx
        .update(briefs)
        .set({ ...fields, slot: null, completedAt: new Date().toISOString() })
        .where(
          and(
            eq(briefs.projectId, projectId),
            eq(briefs.id, id),
            eq(briefs.state, "running"),
          ),
        ),
    ]);
  },
};
