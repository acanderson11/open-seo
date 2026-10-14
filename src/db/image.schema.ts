import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";
import { automationJobs } from "./automation.schema";

export const projectImagePreferences = sqliteTable(
  "project_image_preferences",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    autoGenerate: integer("auto_generate").notNull().default(0),
    style: text("style").notNull().default(""),
    colors: text("colors").notNull().default(""),
    reference: text("reference").notNull().default(""),
    avoid: text("avoid").notNull().default(""),
    guidance: text("guidance").notNull().default(""),
    preferredAssetId: text("preferred_asset_id"),
    version: integer("version").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
  },
);

export const projectImageAssets = sqliteTable(
  "project_image_assets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    r2Key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    sourceUrl: text("source_url"),
    rightsNote: text("rights_note").notNull(),
    altText: text("alt_text").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("project_image_assets_project_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const articleFeaturedImages = sqliteTable(
  "article_featured_images",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    jobId: text("job_id").notNull(),
    artifactVersion: integer("artifact_version").notNull(),
    status: text("status").notNull(),
    source: text("source").notNull(),
    r2Key: text("r2_key"),
    sourceAssetId: text("source_asset_id"),
    sourceUrl: text("source_url"),
    rightsNote: text("rights_note"),
    model: text("model"),
    prompt: text("prompt"),
    visualBrief: text("visual_brief").notNull(),
    altText: text("alt_text").notNull().default(""),
    bytes: integer("bytes"),
    failure: text("failure"),
    costUsd: text("cost_usd"),
    wordpressMediaId: integer("wordpress_media_id"),
    actorId: text("actor_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.jobId],
      foreignColumns: [automationJobs.projectId, automationJobs.id],
    }).onDelete("cascade"),
    index("article_featured_images_job_idx").on(
      table.projectId,
      table.jobId,
      table.artifactVersion,
    ),
    uniqueIndex("article_featured_images_generating_idx")
      .on(table.jobId, table.artifactVersion)
      .where(sql`${table.status} = 'generating'`),
  ],
);
