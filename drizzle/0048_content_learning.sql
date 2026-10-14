CREATE TABLE `article_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`job_id` text NOT NULL,
	`artifact_version` integer NOT NULL,
	`message` text NOT NULL,
	`scope` text NOT NULL,
	`category` text NOT NULL,
	`instruction` text,
	`actor_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `automation_approvals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`job_id`) REFERENCES `automation_jobs`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `article_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`job_id` text NOT NULL,
	`artifact_version` integer NOT NULL,
	`title` text,
	`meta_description` text,
	`body_html` text,
	`context_version` text NOT NULL,
	`policy_version` text NOT NULL,
	`review` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`,`job_id`) REFERENCES `automation_jobs`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_revision_version_idx` ON `article_revisions` (`job_id`,`artifact_version`);--> statement-breakpoint
CREATE TABLE `content_guidelines` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`category` text NOT NULL,
	`instruction` text NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `article_feedback`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `content_guidelines_project_idx` ON `content_guidelines` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `guideline_events` (
	`id` text PRIMARY KEY NOT NULL,
	`guideline_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`guideline_id`) REFERENCES `content_guidelines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guideline_event_version_idx` ON `guideline_events` (`guideline_id`,`version`);