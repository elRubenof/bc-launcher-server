CREATE TABLE `assets` (
	`sha256` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setup_lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`completed_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "setup_lock_single_row" CHECK("setup_lock"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE `admins` ADD `last_seen_at` integer;--> statement-breakpoint
INSERT INTO `setup_lock` (`id`) SELECT 1 WHERE EXISTS (SELECT 1 FROM `admins`);
