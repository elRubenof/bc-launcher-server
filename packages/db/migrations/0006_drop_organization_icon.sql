-- Organizations with only an icon keep it as their logo.
UPDATE `settings` SET `logo_blob` = `icon_blob` WHERE `logo_blob` IS NULL;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `icon_blob`;
