CREATE TABLE "execution_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"request_key" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"priority" text NOT NULL,
	"state" text NOT NULL,
	"version" integer NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_tasks" ADD CONSTRAINT "execution_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_tasks_request_idx" ON "execution_tasks" USING btree ("project_id","request_key");--> statement-breakpoint
CREATE INDEX "execution_tasks_created_idx" ON "execution_tasks" USING btree ("project_id","created_at");