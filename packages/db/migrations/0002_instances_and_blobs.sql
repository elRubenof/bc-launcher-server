ALTER TABLE `assets` RENAME TO `blobs`;--> statement-breakpoint
CREATE TABLE `instance_files` (
	`instance_id` text NOT NULL,
	`path` text NOT NULL,
	`blob_sha256` text NOT NULL,
	`policy` text DEFAULT 'always' NOT NULL,
	PRIMARY KEY(`instance_id`, `path`),
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blob_sha256`) REFERENCES `blobs`(`sha256`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `instance_files_blob` ON `instance_files` (`blob_sha256`);--> statement-breakpoint
CREATE TABLE `instance_managed_dirs` (
	`instance_id` text NOT NULL,
	`path` text NOT NULL,
	PRIMARY KEY(`instance_id`, `path`),
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `instances` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon_blob` text,
	`background_blob` text NOT NULL,
	`colors` text NOT NULL,
	`map_url` text,
	`discord_url` text,
	`web_url` text,
	`mc_version` text NOT NULL,
	`loader` text NOT NULL,
	`loader_version` text,
	`server_address` text,
	`recommended_ram_mb` integer,
	`access` text DEFAULT 'everyone' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`content_version` integer DEFAULT 0 NOT NULL,
	`content_updated_at` integer,
	`content_updated_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`icon_blob`) REFERENCES `blobs`(`sha256`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`background_blob`) REFERENCES `blobs`(`sha256`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`content_updated_by`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `instances_created_at` ON `instances` (`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_blobs` (
	`sha256` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`content_type` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`orphaned_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_blobs`("sha256", "size", "content_type", "created_at", "orphaned_at") SELECT "sha256", "size", "content_type", "created_at", NULL FROM `blobs`;--> statement-breakpoint
DROP TABLE `blobs`;--> statement-breakpoint
ALTER TABLE `__new_blobs` RENAME TO `blobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;