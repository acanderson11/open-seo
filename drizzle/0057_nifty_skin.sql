CREATE TABLE `article_featured_images` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`job_id` text NOT NULL,
	`artifact_version` integer NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`r2_key` text,
	`source_asset_id` text,
	`source_url` text,
	`rights_note` text,
	`model` text,
	`prompt` text,
	`visual_brief` text NOT NULL,
	`alt_text` text DEFAULT '' NOT NULL,
	`bytes` integer,
	`failure` text,
	`cost_usd` text,
	`wordpress_media_id` integer,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`,`job_id`) REFERENCES `automation_jobs`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `article_featured_images_job_idx` ON `article_featured_images` (`project_id`,`job_id`,`artifact_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `article_featured_images_generating_idx` ON `article_featured_images` (`job_id`,`artifact_version`) WHERE "article_featured_images"."status" = 'generating';--> statement-breakpoint
CREATE TABLE `project_image_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`source_url` text,
	`rights_note` text NOT NULL,
	`alt_text` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_image_assets_project_idx` ON `project_image_assets` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_image_preferences` (
	`project_id` text PRIMARY KEY NOT NULL,
	`style` text DEFAULT '' NOT NULL,
	`colors` text DEFAULT '' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`avoid` text DEFAULT '' NOT NULL,
	`guidance` text DEFAULT '' NOT NULL,
	`preferred_asset_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `article_revisions` ADD `featured_image_id` text;--> statement-breakpoint
ALTER TABLE `automation_approvals` ADD `featured_image_id` text;--> statement-breakpoint
ALTER TABLE `automation_jobs` ADD `featured_image_id` text;