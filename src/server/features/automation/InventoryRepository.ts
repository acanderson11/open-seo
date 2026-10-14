import { and, eq, asc } from "drizzle-orm";
import { db } from "@/db";
import {
  siteInventoryPages as pages,
  siteInventoryLinks as links,
  audits,
  auditPages,
  auditIssues,
} from "@/db/schema";
import { runBatch } from "@/db/runBatch";
import { INVENTORY_LIMIT } from "./InventoryRules";
export const InventoryRepository = {
  async list(projectId: string) {
    return db
      .select()
      .from(pages)
      .where(eq(pages.projectId, projectId))
      .orderBy(asc(pages.url))
      .limit(INVENTORY_LIMIT);
  },
  async links(projectId: string) {
    return db
      .select()
      .from(links)
      .where(eq(links.projectId, projectId))
      .orderBy(asc(links.id))
      .limit(50001);
  },
  async seed(values: typeof pages.$inferInsert) {
    await db.insert(pages).values(values).onConflictDoNothing();
  },
  async auditEvidence(projectId: string, auditId: string) {
    const pageRows = await db
      .select({ page: auditPages })
      .from(auditPages)
      .innerJoin(audits, eq(audits.id, auditPages.auditId))
      .where(and(eq(audits.projectId, projectId), eq(audits.id, auditId)))
      .orderBy(asc(auditPages.url))
      .limit(INVENTORY_LIMIT);
    const issues = await db
      .select({ issue: auditIssues })
      .from(auditIssues)
      .innerJoin(audits, eq(audits.id, auditIssues.auditId))
      .where(and(eq(audits.projectId, projectId), eq(audits.id, auditId)))
      .orderBy(asc(auditIssues.id))
      .limit(501);
    return {
      pages: pageRows.map((r) => r.page),
      issues: issues.map((r) => r.issue),
    };
  },
  async unavailable(
    projectId: string,
    id: string,
    checkedAt: string,
    diagnostic?: { reason: string; status: number | null },
  ) {
    await db
      .update(pages)
      .set({
        readState: "unavailable",
        checkedAt,
        readFailure: diagnostic?.reason ?? "unknown",
        readStatus: diagnostic?.status ?? null,
      })
      .where(and(eq(pages.projectId, projectId), eq(pages.id, id)));
  },
  async save(
    projectId: string,
    id: string,
    values: Partial<typeof pages.$inferInsert>,
    outgoing: { targetUrl: string; anchor: string }[],
  ) {
    const owner = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.projectId, projectId), eq(pages.id, id)))
      .limit(1);
    if (!owner.length) return;
    // One atomic page snapshot: link removal and replacement cannot expose a partial graph.
    await runBatch((tx) => [
      tx
        .update(pages)
        .set(values)
        .where(and(eq(pages.id, id), eq(pages.projectId, projectId))),
      tx
        .delete(links)
        .where(and(eq(links.projectId, projectId), eq(links.pageId, id))),
      ...outgoing
        .slice(0, 100)
        .map((link, index) =>
          tx
            .insert(links)
            .values({ id: `${id}:${index}`, projectId, pageId: id, ...link }),
        ),
    ]);
  },
};
