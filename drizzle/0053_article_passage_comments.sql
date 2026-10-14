CREATE TABLE `article_passage_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`feedback_id` text NOT NULL,
	`block_index` integer NOT NULL,
	`quote` text NOT NULL,
	`message` text NOT NULL,
	FOREIGN KEY (`feedback_id`) REFERENCES `article_feedback`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_passage_feedback_block_idx` ON `article_passage_comments` (`feedback_id`,`block_index`);