CREATE TABLE `instance_blacklist` (
	`instance_id` text NOT NULL,
	`player_uuid` text NOT NULL,
	`reason` text,
	`expires_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`instance_id`, `player_uuid`),
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_uuid`) REFERENCES `players`(`uuid`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `instance_blacklist_player` ON `instance_blacklist` (`player_uuid`);--> statement-breakpoint
CREATE TABLE `instance_whitelist` (
	`instance_id` text NOT NULL,
	`player_uuid` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`instance_id`, `player_uuid`),
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_uuid`) REFERENCES `players`(`uuid`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `instance_whitelist_player` ON `instance_whitelist` (`player_uuid`);--> statement-breakpoint
CREATE TABLE `org_blacklist` (
	`player_uuid` text PRIMARY KEY NOT NULL,
	`reason` text,
	`expires_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`player_uuid`) REFERENCES `players`(`uuid`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `org_whitelist` (
	`player_uuid` text PRIMARY KEY NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`player_uuid`) REFERENCES `players`(`uuid`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `players` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`first_seen_at` integer,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `players_last_seen_at` ON `players` (`last_seen_at`);