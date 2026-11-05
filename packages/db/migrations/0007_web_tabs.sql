ALTER TABLE `instances` ADD `tabs` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- An instance's map becomes its first web tab.
UPDATE `instances` SET `tabs` = json_array(json_object('label', 'Mapa', 'url', `map_url`, 'icon', 'map', 'openIn', 'launcher')) WHERE `map_url` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `instances` DROP COLUMN `map_url`;
