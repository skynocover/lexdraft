ALTER TABLE `cases` ADD `undisputed_facts` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `information_gaps` text;--> statement-breakpoint
ALTER TABLE `disputes` DROP COLUMN `facts`;