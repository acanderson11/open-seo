import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  uniqueIndex,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
export const automationPolicies = pgTable("automation_policies", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  enabled: integer("enabled").notNull(),
  monthlyLimit: integer("monthly_limit").notNull(),
  approval: text("approval").notNull(),
  delivery: text("delivery", { enum: ["manual", "wordpress"] })
    .notNull()
    .default("manual"),
  period: text("period").notNull(),
  used: integer("used").notNull(),
  busyJobId: text("busy_job_id"),
  autopilot: integer("autopilot").notNull().default(0),
  monthlyTarget: integer("monthly_target").notNull().default(4),
  reviewerEmail: text("reviewer_email"),
  lastPlanStatus: text("last_plan_status"),
});
export const automationJobs = pgTable(
  "automation_jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requestKey: text("request_key").notNull(),
    topic: text("topic").notNull(),
    targetUrl: text("target_url").notNull(),
    actorId: text("actor_id").notNull(),
    state: text("state").notNull(),
    priority: text("priority", { enum: ["critical", "high", "normal", "low"] })
      .notNull()
      .default("normal"),
    contextVersion: text("context_version").notNull(),
    policyVersion: text("policy_version").notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
    publishedAt: text("published_at"),
    n8nExecutionId: text("n8n_execution_id"),
    message: text("message"),
    title: text("title"),
    metaDescription: text("meta_description"),
    bodyHtml: text("body_html"),
    featuredImageId: text("featured_image_id"),
    review: text("review"),
    qualityPassed: integer("quality_passed"),
    kind: text("kind").notNull().default("refresh_content"),
    rationale: text("rationale"),
    wordpressVersion: text("wordpress_version"),
    wordpressPostId: integer("wordpress_post_id"),
    publishedUrl: text("published_url"),
    notificationState: text("notification_state"),
  },
  (table) => [
    uniqueIndex("automation_jobs_request_idx").on(
      table.projectId,
      table.requestKey,
    ),
    uniqueIndex("automation_jobs_project_id_idx").on(table.projectId, table.id),
    index("automation_jobs_created_idx").on(table.projectId, table.createdAt),
  ],
);
export const articleFollowUps = pgTable(
  "article_follow_ups",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    jobId: text("job_id")
      .notNull()
      .references(() => automationJobs.id, { onDelete: "cascade" }),
    stage: text("stage", {
      enum: [
        "technical",
        "indexing_3",
        "indexing_7",
        "metrics_14",
        "metrics_30",
        "reassess_60",
        "reassess_90",
      ],
    }).notNull(),
    dueAt: text("due_at").notNull(),
    baselineAt: text("baseline_at").notNull(),
    scheduleBasis: text("schedule_basis", {
      enum: ["publication", "monitoring"],
    }).notNull(),
    state: text("state", {
      enum: ["pending", "running", "complete", "unavailable"],
    })
      .notNull()
      .default("pending"),
    leaseUntil: text("lease_until"),
    attempts: integer("attempts").notNull().default(0),
    checkedAt: text("checked_at"),
    outcome: text("outcome"),
    detail: text("detail"),
    clicks: integer("clicks"),
    impressions: integer("impressions"),
    taskId: text("task_id"),
  },
  (t) => [
    uniqueIndex("article_follow_ups_job_stage_idx").on(t.jobId, t.stage),
    index("article_follow_ups_due_idx").on(t.state, t.dueAt),
  ],
);
export const automationApprovals = pgTable(
  "automation_approvals",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    jobId: text("job_id").notNull(),
    artifactVersion: integer("artifact_version").notNull(),
    role: text("role").notNull(),
    actorId: text("actor_id").notNull(),
    decision: text("decision").notNull(),
    featuredImageId: text("featured_image_id"),
    revokedAt: text("revoked_at"),
    revokedBy: text("revoked_by"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.jobId],
      foreignColumns: [automationJobs.projectId, automationJobs.id],
    }).onDelete("cascade"),
    uniqueIndex("automation_approvals_version_role_idx")
      .on(table.jobId, table.artifactVersion, table.role)
      .where(sql`${table.revokedAt} is null`),
  ],
);

export const executionTasks = pgTable(
  "execution_tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requestKey: text("request_key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    category: text("category", {
      enum: [
        "technical",
        "content",
        "local",
        "backlinks",
        "analytics",
        "general",
      ],
    }).notNull(),
    priority: text("priority", {
      enum: ["critical", "high", "normal", "low"],
    }).notNull(),
    state: text("state", {
      enum: ["todo", "in_progress", "blocked", "review", "ready", "done"],
    }).notNull(),
    version: integer("version").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("execution_tasks_request_idx").on(
      table.projectId,
      table.requestKey,
    ),
    index("execution_tasks_created_idx").on(table.projectId, table.createdAt),
  ],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    state: text("state").notNull(),
    message: text("message"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("automation_runs_day_idx").on(t.projectId, t.day)],
);
export const wordpressConnections = pgTable("wordpress_connections", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  baseUrl: text("base_url").notNull(),
  username: text("username").notNull(),
  passwordCipher: text("password_cipher").notNull(),
  verifiedAt: text("verified_at").notNull(),
});
export const automationReviewLinks = pgTable(
  "automation_review_links",
  {
    tokenHash: text("token_hash").primaryKey(),
    projectId: text("project_id").notNull(),
    jobId: text("job_id").notNull(),
    artifactVersion: integer("artifact_version").notNull(),
    role: text("role").notNull(),
    recipient: text("recipient").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.jobId],
      foreignColumns: [automationJobs.projectId, automationJobs.id],
    }).onDelete("cascade"),
    uniqueIndex("automation_review_job_idx")
      .on(t.jobId, t.artifactVersion)
      .where(sql`${t.usedAt} is null`),
  ],
);

export const articleFeedback = pgTable(
  "article_feedback",
  {
    id: text("id")
      .primaryKey()
      .references(() => automationApprovals.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    jobId: text("job_id").notNull(),
    artifactVersion: integer("artifact_version").notNull(),
    message: text("message").notNull(),
    scope: text("scope").notNull(),
    category: text("category").notNull(),
    instruction: text("instruction"),
    editToken: text("edit_token"),
    actorId: text("actor_id").notNull(),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.jobId],
      foreignColumns: [automationJobs.projectId, automationJobs.id],
    }).onDelete("cascade"),
  ],
);
export const articleRevisions = pgTable(
  "article_revisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    jobId: text("job_id").notNull(),
    artifactVersion: integer("artifact_version").notNull(),
    title: text("title"),
    metaDescription: text("meta_description"),
    bodyHtml: text("body_html"),
    featuredImageId: text("featured_image_id"),
    contextVersion: text("context_version").notNull(),
    policyVersion: text("policy_version").notNull(),
    review: text("review"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.jobId],
      foreignColumns: [automationJobs.projectId, automationJobs.id],
    }).onDelete("cascade"),
    uniqueIndex("article_revision_version_idx").on(t.jobId, t.artifactVersion),
  ],
);
export const contentGuidelines = pgTable(
  "content_guidelines",
  {
    id: text("id")
      .primaryKey()
      .references(() => articleFeedback.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    instruction: text("instruction").notNull(),
    status: text("status").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("content_guidelines_project_idx").on(t.projectId, t.status)],
);
export const guidelineEvents = pgTable(
  "guideline_events",
  {
    id: text("id").primaryKey(),
    guidelineId: text("guideline_id")
      .notNull()
      .references(() => contentGuidelines.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("guideline_event_version_idx").on(t.guidelineId, t.version),
  ],
);

export const articlePassageComments = pgTable(
  "article_passage_comments",
  {
    id: text("id").primaryKey(),
    feedbackId: text("feedback_id")
      .notNull()
      .references(() => articleFeedback.id, { onDelete: "cascade" }),
    blockIndex: integer("block_index").notNull(),
    quote: text("quote").notNull(),
    message: text("message").notNull(),
  },
  (t) => [
    uniqueIndex("article_passage_feedback_block_idx").on(
      t.feedbackId,
      t.blockIndex,
    ),
  ],
);

export const articleResearchSources = pgTable(
  "article_research_sources",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    jobId: text("job_id").notNull(),
    artifactVersion: integer("artifact_version").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    query: text("query").notNull(),
    observedAt: text("observed_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.jobId],
      foreignColumns: [automationJobs.projectId, automationJobs.id],
    }).onDelete("cascade"),
    index("article_research_job_idx").on(
      t.projectId,
      t.jobId,
      t.artifactVersion,
    ),
  ],
);
