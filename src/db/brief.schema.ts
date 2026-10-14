import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";
export const seoBriefs = sqliteTable(
  "seo_briefs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requestKey: text("request_key").notNull(),
    actorId: text("actor_id").notNull(),
    topic: text("topic").notNull(),
    includeSerp: integer("include_serp").notNull(),
    slot: text("slot"),
    state: text("state").notNull().default("running"),
    message: text("message"),
    contextVersion: text("context_version"),
    evidenceVersion: text("evidence_version"),
    contextText: text("context_text"),
    model: text("model"),
    title: text("title"),
    action: text("action"),
    targetUrl: text("target_url"),
    audience: text("audience"),
    intent: text("intent"),
    angle: text("angle"),
    rationale: text("rationale"),
    successMeasure: text("success_measure"),
    confidence: text("confidence"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (t) => [
    uniqueIndex("seo_brief_request_idx").on(t.projectId, t.requestKey),
    uniqueIndex("seo_brief_slot_idx").on(t.projectId, t.slot),
    index("seo_brief_project_idx").on(t.projectId, t.createdAt),
  ],
);
export const seoBriefEvidence = sqliteTable(
  "seo_brief_evidence",
  {
    id: text("id").notNull(),
    briefId: text("brief_id")
      .notNull()
      .references(() => seoBriefs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    content: text("content").notNull(),
    observedAt: text("observed_at").notNull(),
  },
  (t) => [uniqueIndex("seo_brief_evidence_idx").on(t.briefId, t.id)],
);
export const seoBriefItems = sqliteTable(
  "seo_brief_items",
  {
    id: text("id").primaryKey(),
    briefId: text("brief_id")
      .notNull()
      .references(() => seoBriefs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    position: integer("position").notNull(),
    heading: text("heading"),
    detail: text("detail").notNull(),
    evidenceId: text("evidence_id"),
    quote: text("quote"),
  },
  (t) => [
    index("seo_brief_items_idx").on(t.briefId, t.position),
    foreignKey({
      columns: [t.briefId, t.evidenceId],
      foreignColumns: [seoBriefEvidence.briefId, seoBriefEvidence.id],
    }).onDelete("no action"),
  ],
);
