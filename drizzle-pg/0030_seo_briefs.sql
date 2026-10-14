CREATE TABLE "seo_brief_evidence" (
	"id" text NOT NULL,
	"brief_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"content" text NOT NULL,
	"observed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_brief_items" (
	"id" text PRIMARY KEY NOT NULL,
	"brief_id" text NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"heading" text,
	"detail" text NOT NULL,
	"evidence_id" text,
	"quote" text
);
--> statement-breakpoint
CREATE TABLE "seo_briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"request_key" text NOT NULL,
	"actor_id" text NOT NULL,
	"topic" text NOT NULL,
	"include_serp" integer NOT NULL,
	"slot" text,
	"state" text DEFAULT 'running' NOT NULL,
	"message" text,
	"context_version" text,
	"evidence_version" text,
	"context_text" text,
	"model" text,
	"title" text,
	"action" text,
	"target_url" text,
	"audience" text,
	"intent" text,
	"angle" text,
	"rationale" text,
	"success_measure" text,
	"confidence" text,
	"created_at" text NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
ALTER TABLE "seo_brief_evidence" ADD CONSTRAINT "seo_brief_evidence_brief_id_seo_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."seo_briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_brief_items" ADD CONSTRAINT "seo_brief_items_brief_id_seo_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."seo_briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_brief_items" ADD CONSTRAINT "seo_brief_items_brief_id_evidence_id_seo_brief_evidence_brief_id_id_fk" FOREIGN KEY ("brief_id","evidence_id") REFERENCES "public"."seo_brief_evidence"("brief_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_briefs" ADD CONSTRAINT "seo_briefs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seo_brief_evidence_idx" ON "seo_brief_evidence" USING btree ("brief_id","id");--> statement-breakpoint
CREATE INDEX "seo_brief_items_idx" ON "seo_brief_items" USING btree ("brief_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_brief_request_idx" ON "seo_briefs" USING btree ("project_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_brief_slot_idx" ON "seo_briefs" USING btree ("project_id","slot");--> statement-breakpoint
CREATE INDEX "seo_brief_project_idx" ON "seo_briefs" USING btree ("project_id","created_at");