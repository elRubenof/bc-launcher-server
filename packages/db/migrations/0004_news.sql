CREATE TABLE `news` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`image_blob` text,
	`link` text,
	`pinned` integer DEFAULT false NOT NULL,
	`published_at` integer NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_blob`) REFERENCES `blobs`(`sha256`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `news_instance` ON `news` (`instance_id`,`pinned`,`published_at`);