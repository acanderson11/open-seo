CREATE TABLE "article_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"job_id" text NOT NULL,
	"artifact_version" integer NOT NULL,
	"message" text NOT NULL,
	"scope" text NOT NULL,
	"category" text NOT NULL,
	"instruction" text,
	"actor_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"job_id" text NOT NULL,
	"artifact_version" integer NOT NULL,
	"title" text,
	"meta_description" text,
	"body_html" text,
	"context_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"review" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_guidelines" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"category" text NOT NULL,
	"instruction" text NOT NULL,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guideline_events" (
	"id" text PRIMARY KEY NOT NULL,
	"guideline_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_feedback" ADD CONSTRAINT "article_feedback_id_automation_approvals_id_fk" FOREIGN KEY ("id") REFERENCES "public"."automation_approvals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_feedback" ADD CONSTRAINT "article_feedback_project_id_job_id_automation_jobs_project_id_id_fk" FOREIGN KEY ("project_id","job_id") REFERENCES "public"."automation_jobs"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_project_id_job_id_automation_jobs_project_id_id_fk" FOREIGN KEY ("project_id","job_id") REFERENCES "public"."automation_jobs"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_guidelines" ADD CONSTRAINT "content_guidelines_id_article_feedback_id_fk" FOREIGN KEY ("id") REFERENCES "public"."article_feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_guidelines" ADD CONSTRAINT "content_guidelines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guideline_events" ADD CONSTRAINT "guideline_events_guideline_id_content_guidelines_id_fk" FOREIGN KEY ("guideline_id") REFERENCES "public"."content_guidelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_revision_version_idx" ON "article_revisions" USING btree ("job_id","artifact_version");--> statement-breakpoint
CREATE INDEX "content_guidelines_project_idx" ON "content_guidelines" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "guideline_event_version_idx" ON "guideline_events" USING btree ("guideline_id","version");