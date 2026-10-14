CREATE TABLE "automation_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"job_id" text NOT NULL,
	"artifact_version" integer NOT NULL,
	"role" text NOT NULL,
	"actor_id" text NOT NULL,
	"decision" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"request_key" text NOT NULL,
	"topic" text NOT NULL,
	"target_url" text NOT NULL,
	"actor_id" text NOT NULL,
	"state" text NOT NULL,
	"context_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" text NOT NULL,
	"completed_at" text,
	"n8n_execution_id" text,
	"message" text,
	"title" text,
	"meta_description" text,
	"body_html" text,
	"review" text,
	"quality_passed" integer
);
--> statement-breakpoint
CREATE TABLE "automation_policies" (
	"project_id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"enabled" integer NOT NULL,
	"monthly_limit" integer NOT NULL,
	"approval" text NOT NULL,
	"period" text NOT NULL,
	"used" integer NOT NULL,
	"busy_job_id" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "automation_jobs_project_id_idx" ON "automation_jobs" USING btree ("project_id","id");--> statement-breakpoint
ALTER TABLE "automation_approvals" ADD CONSTRAINT "automation_approvals_project_id_job_id_automation_jobs_project_id_id_fk" FOREIGN KEY ("project_id","job_id") REFERENCES "public"."automation_jobs"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD CONSTRAINT "automation_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_policies" ADD CONSTRAINT "automation_policies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_approvals_version_role_idx" ON "automation_approvals" USING btree ("job_id","artifact_version","role");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_jobs_request_idx" ON "automation_jobs" USING btree ("project_id","request_key");--> statement-breakpoint

CREATE INDEX "automation_jobs_created_idx" ON "automation_jobs" USING btree ("project_id","created_at");
