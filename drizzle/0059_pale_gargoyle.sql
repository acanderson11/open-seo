CREATE TABLE `article_follow_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`job_id` text NOT NULL,
	`stage` text NOT NULL,
	`due_at` text NOT NULL,
	`baseline_at` text NOT NULL,
	`schedule_basis` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`lease_until` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`checked_at` text,
	`outcome` text,
	`detail` text,
	`clicks` integer,
	`impressions` integer,
	`task_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `automation_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_follow_ups_job_stage_idx` ON `article_follow_ups` (`job_id`,`stage`);--> statement-breakpoint
CREATE INDEX `article_follow_ups_due_idx` ON `article_follow_ups` (`state`,`due_at`);--> statement-breakpoint
ALTER TABLE `automation_jobs` ADD `published_at` text;