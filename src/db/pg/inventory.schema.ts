import {
  pgTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";

export const siteInventoryPages = pgTable(
  "site_inventory_pages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull().default(""),
    heading: text("heading").notNull().default(""),
    description: text("description").notNull().default(""),
    content: text("content").notNull().default(""),
    contentHash: text("content_hash"),
    canonical: text("canonical"),
    robots: text("robots"),
    purpose: text("purpose").notNull().default("unknown"),
    readState: text("read_state", { enum: ["pending", "read", "unavailable"] })
      .notNull()
      .default("pending"),
    readFailure: text("read_failure"),
    readStatus: integer("read_status"),
    checkedAt: text("checked_at"),
    contentAt: text("content_at"),
    changedAt: text("changed_at"),
    discoveredAt: text("discovered_at").notNull(),
    linksLimited: integer("links_limited").notNull().default(0),
  },
  (t) => [uniqueIndex("site_inventory_project_url_idx").on(t.projectId, t.url)],
);
export const siteInventoryLinks = pgTable(
  "site_inventory_links",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => siteInventoryPages.id, { onDelete: "cascade" }),
    targetUrl: text("target_url").notNull(),
    anchor: text("anchor").notNull().default(""),
  },
  (t) => [
    uniqueIndex("site_inventory_page_target_idx").on(t.pageId, t.targetUrl),
    index("site_inventory_links_project_idx").on(t.projectId),
  ],
);
