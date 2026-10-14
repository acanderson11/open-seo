CREATE TABLE "automation_review_links" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"job_id" text NOT NULL,
	"artifact_version" integer NOT NULL,
	"role" text NOT NULL,
	"recipient" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_at" text
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"day" text NOT NULL,
	"state" text NOT NULL,
	"message" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wordpress_connections" (
	"project_id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"base_url" text NOT NULL,
	"username" text NOT NULL,
	"password_cipher" text NOT NULL,
	"verified_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD COLUMN "kind" text DEFAULT 'refresh_content' NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD COLUMN "rationale" text;--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD COLUMN "wordpress_version" text;--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD COLUMN "wordpress_post_id" integer;--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD COLUMN "published_url" text;--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD COLUMN "notification_state" text;--> statement-breakpoint
ALTER TABLE "automation_policies" ADD COLUMN "autopilot" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_policies" ADD COLUMN "monthly_target" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_policies" ADD COLUMN "reviewer_email" text;--> statement-breakpoint
ALTER TABLE "automation_policies" ADD COLUMN "last_plan_status" text;--> statement-breakpoint
ALTER TABLE "automation_review_links" ADD CONSTRAINT "automation_review_links_project_id_job_id_automation_jobs_project_id_id_fk" FOREIGN KEY ("project_id","job_id") REFERENCES "public"."automation_jobs"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wordpress_connections" ADD CONSTRAINT "wordpress_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_review_job_idx" ON "automation_review_links" USING btree ("job_id","artifact_version");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_day_idx" ON "automation_runs" USING btree ("project_id","day");