CREATE TABLE `seo_brief_evidence` (
	`id` text NOT NULL,
	`brief_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`content` text NOT NULL,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`brief_id`) REFERENCES `seo_briefs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seo_brief_evidence_idx` ON `seo_brief_evidence` (`brief_id`,`id`);--> statement-breakpoint
CREATE TABLE `seo_brief_items` (
	`id` text PRIMARY KEY NOT NULL,
	`brief_id` text NOT NULL,
	`kind` text NOT NULL,
	`position` integer NOT NULL,
	`heading` text,
	`detail` text NOT NULL,
	`evidence_id` text,
	`quote` text,
	FOREIGN KEY (`brief_id`) REFERENCES `seo_briefs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brief_id`,`evidence_id`) REFERENCES `seo_brief_evidence`(`brief_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `seo_brief_items_idx` ON `seo_brief_items` (`brief_id`,`position`);--> statement-breakpoint
CREATE TABLE `seo_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`request_key` text NOT NULL,
	`actor_id` text NOT NULL,
	`topic` text NOT NULL,
	`include_serp` integer NOT NULL,
	`slot` text,
	`state` text DEFAULT 'running' NOT NULL,
	`message` text,
	`context_version` text,
	`evidence_version` text,
	`context_text` text,
	`model` text,
	`title` text,
	`action` text,
	`target_url` text,
	`audience` text,
	`intent` text,
	`angle` text,
	`rationale` text,
	`success_measure` text,
	`confidence` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seo_brief_request_idx` ON `seo_briefs` (`project_id`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `seo_brief_slot_idx` ON `seo_briefs` (`project_id`,`slot`);--> statement-breakpoint
CREATE INDEX `seo_brief_project_idx` ON `seo_briefs` (`project_id`,`created_at`);