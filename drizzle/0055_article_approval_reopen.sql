DROP INDEX `automation_approvals_version_role_idx`;--> statement-breakpoint
ALTER TABLE `automation_approvals` ADD `revoked_at` text;--> statement-breakpoint
ALTER TABLE `automation_approvals` ADD `revoked_by` text;--> statement-breakpoint
CREATE UNIQUE INDEX `automation_approvals_version_role_idx` ON `automation_approvals` (`job_id`,`artifact_version`,`role`) WHERE "automation_approvals"."revoked_at" is null;--> statement-breakpoint
DROP INDEX `automation_review_job_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `automation_review_job_idx` ON `automation_review_links` (`job_id`,`artifact_version`) WHERE "automation_review_links"."used_at" is null;