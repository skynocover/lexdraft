-- 爭點分析重構：不爭執事項提升為案件層級、facts 簡化為 disputed_facts
ALTER TABLE `cases` ADD `undisputed_facts` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `information_gaps` text;--> statement-breakpoint
ALTER TABLE `disputes` RENAME COLUMN `facts` TO `disputed_facts`;
