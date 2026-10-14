CREATE TABLE "article_follow_ups" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"job_id" text NOT NULL,
	"stage" text NOT NULL,
	"due_at" text NOT NULL,
	"baseline_at" text NOT NULL,
	"schedule_basis" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"lease_until" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"checked_at" text,
	"outcome" text,
	"detail" text,
	"clicks" integer,
	"impressions" integer,
	"task_id" text
);
--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD COLUMN "published_at" text;--> statement-breakpoint
ALTER TABLE "article_follow_ups" ADD CONSTRAINT "article_follow_ups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_follow_ups" ADD CONSTRAINT "article_follow_ups_job_id_automation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."automation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_follow_ups_job_stage_idx" ON "article_follow_ups" USING btree ("job_id","stage");--> statement-breakpoint
CREATE INDEX "article_follow_ups_due_idx" ON "article_follow_ups" USING btree ("state","due_at");