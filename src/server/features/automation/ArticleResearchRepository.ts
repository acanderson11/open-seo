import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { articleResearchSources as sources } from "@/db/schema";
const versionScope = (projectId: string, jobId: string, version: number) =>
  and(
    eq(sources.projectId, projectId),
    eq(sources.jobId, jobId),
    eq(sources.artifactVersion, version),
  );
export const ArticleResearchRepository = {
  /** Replaces a version's sources, so a rerun of that version does not list both runs. */
  async replace(
    projectId: string,
    jobId: string,
    version: number,
    rows: (typeof sources.$inferInsert)[],
  ) {
    await runBatch((tx) => [
      tx.delete(sources).where(versionScope(projectId, jobId, version)),
      ...(rows.length ? [tx.insert(sources).values(rows)] : []),
    ]);
  },
  async list(projectId: string, jobId: string, version: number) {
    return db
      .select()
      .from(sources)
      .where(versionScope(projectId, jobId, version));
  },
};
