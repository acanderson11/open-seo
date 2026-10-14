CREATE TABLE `site_inventory_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`page_id` text NOT NULL,
	`target_url` text NOT NULL,
	`anchor` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `site_inventory_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_inventory_page_target_idx` ON `site_inventory_links` (`page_id`,`target_url`);--> statement-breakpoint
CREATE INDEX `site_inventory_links_project_idx` ON `site_inventory_links` (`project_id`);--> statement-breakpoint
CREATE TABLE `site_inventory_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`heading` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`content_hash` text,
	`canonical` text,
	`robots` text,
	`purpose` text DEFAULT 'unknown' NOT NULL,
	`read_state` text DEFAULT 'pending' NOT NULL,
	`checked_at` text,
	`content_at` text,
	`changed_at` text,
	`discovered_at` text NOT NULL,
	`links_limited` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_inventory_project_url_idx` ON `site_inventory_pages` (`project_id`,`url`);