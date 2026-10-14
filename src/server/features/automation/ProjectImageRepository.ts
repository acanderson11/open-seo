import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  projectImageAssets as assets,
  projectImagePreferences as preferences,
} from "@/db/schema";

/** A project's image preferences and its library of reusable image assets. */
export const ProjectImageRepository = {
  async preferences(projectId: string) {
    return (
      (
        await db
          .select()
          .from(preferences)
          .where(eq(preferences.projectId, projectId))
      )[0] ?? null
    );
  },
  async savePreferences(
    projectId: string,
    input: {
      expectedVersion: number | null;
      autoGenerate: boolean;
      style: string;
      colors: string;
      reference: string;
      avoid: string;
      guidance: string;
      preferredAssetId: string | null;
    },
  ) {
    const values = {
      autoGenerate: input.autoGenerate ? 1 : 0,
      style: input.style,
      colors: input.colors,
      reference: input.reference,
      avoid: input.avoid,
      guidance: input.guidance,
      preferredAssetId: input.preferredAssetId,
      updatedAt: new Date().toISOString(),
    };
    if (
      input.preferredAssetId &&
      !(await this.asset(projectId, input.preferredAssetId))
    )
      return false;
    if (input.expectedVersion === null)
      return (
        (
          await db
            .insert(preferences)
            .values({ projectId, ...values, version: 1 })
            .onConflictDoNothing()
            .returning()
        ).length === 1
      );
    return (
      (
        await db
          .update(preferences)
          .set({ ...values, version: input.expectedVersion + 1 })
          .where(
            and(
              eq(preferences.projectId, projectId),
              eq(preferences.version, input.expectedVersion),
            ),
          )
          .returning()
      ).length === 1
    );
  },
  async rememberFeedback(projectId: string, feedback: string) {
    const current = await this.preferences(projectId);
    if (!current)
      return (
        (
          await db
            .insert(preferences)
            .values({
              projectId,
              guidance: feedback.slice(0, 1000),
              updatedAt: new Date().toISOString(),
            })
            .onConflictDoNothing()
            .returning()
        ).length === 1
      );
    const guidance = [current.guidance, feedback]
      .filter(Boolean)
      .join("\n")
      .slice(-1000);
    return (
      (
        await db
          .update(preferences)
          .set({
            guidance,
            version: current.version + 1,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(preferences.projectId, projectId),
              eq(preferences.version, current.version),
            ),
          )
          .returning()
      ).length === 1
    );
  },
  async asset(projectId: string, id: string) {
    return (
      (
        await db
          .select()
          .from(assets)
          .where(and(eq(assets.projectId, projectId), eq(assets.id, id)))
      )[0] ?? null
    );
  },
  async assets(projectId: string) {
    return db
      .select()
      .from(assets)
      .where(eq(assets.projectId, projectId))
      .orderBy(desc(assets.createdAt))
      .limit(30);
  },
  async addAsset(input: typeof assets.$inferInsert) {
    return (
      (await db.insert(assets).values(input).onConflictDoNothing().returning())
        .length === 1
    );
  },
};
