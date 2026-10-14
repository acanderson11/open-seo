CREATE TABLE `article_research_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`job_id` text NOT NULL,
	`artifact_version` integer NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`query` text NOT NULL,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`project_id`,`job_id`) REFERENCES `automation_jobs`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `article_research_job_idx` ON `article_research_sources` (`project_id`,`job_id`,`artifact_version`);