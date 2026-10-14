import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { articleResearchSources as sources } from "@/db/schema";
export const ArticleResearchRepository = {
  async save(rows: (typeof sources.$inferInsert)[]) {
    if (rows.length) await db.insert(sources).values(rows);
  },
  async list(projectId: string, jobId: string, version: number) {
    return db
      .select()
      .from(sources)
      .where(
        and(
          eq(sources.projectId, projectId),
          eq(sources.jobId, jobId),
          eq(sources.artifactVersion, version),
        ),
      );
  },
};
