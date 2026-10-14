CREATE TABLE "article_research_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"job_id" text NOT NULL,
	"artifact_version" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"query" text NOT NULL,
	"observed_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_research_sources" ADD CONSTRAINT "article_research_sources_project_id_job_id_automation_jobs_project_id_id_fk" FOREIGN KEY ("project_id","job_id") REFERENCES "public"."automation_jobs"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_research_job_idx" ON "article_research_sources" USING btree ("project_id","job_id","artifact_version");