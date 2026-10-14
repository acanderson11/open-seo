CREATE TABLE `automation_review_links` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`job_id` text NOT NULL,
	`artifact_version` integer NOT NULL,
	`role` text NOT NULL,
	`recipient` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`project_id`,`job_id`) REFERENCES `automation_jobs`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_review_job_idx` ON `automation_review_links` (`job_id`,`artifact_version`);--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`day` text NOT NULL,
	`state` text NOT NULL,
	`message` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_runs_day_idx` ON `automation_runs` (`project_id`,`day`);--> statement-breakpoint
CREATE TABLE `wordpress_connections` (
	`project_id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`base_url` text NOT NULL,
	`username` text NOT NULL,
	`password_cipher` text NOT NULL,
	`verified_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `automation_jobs` ADD `kind` text DEFAULT 'refresh_content' NOT NULL;--> statement-breakpoint
ALTER TABLE `automation_jobs` ADD `rationale` text;--> statement-breakpoint
ALTER TABLE `automation_jobs` ADD `wordpress_version` text;--> statement-breakpoint
ALTER TABLE `automation_jobs` ADD `wordpress_post_id` integer;--> statement-breakpoint
ALTER TABLE `automation_jobs` ADD `published_url` text;--> statement-breakpoint
ALTER TABLE `automation_jobs` ADD `notification_state` text;--> statement-breakpoint
ALTER TABLE `automation_policies` ADD `autopilot` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `automation_policies` ADD `monthly_target` integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE `automation_policies` ADD `reviewer_email` text;--> statement-breakpoint
ALTER TABLE `automation_policies` ADD `last_plan_status` text;