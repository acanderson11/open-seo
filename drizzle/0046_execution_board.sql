CREATE TABLE `execution_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`request_key` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`priority` text NOT NULL,
	`state` text NOT NULL,
	`version` integer NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `execution_tasks_request_idx` ON `execution_tasks` (`project_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `execution_tasks_created_idx` ON `execution_tasks` (`project_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `automation_jobs` ADD `priority` text DEFAULT 'normal' NOT NULL;