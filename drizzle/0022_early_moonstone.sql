ALTER TABLE `templates` ADD `brief_mode` text;--> statement-breakpoint
DELETE FROM `templates` WHERE `is_default` = 0;