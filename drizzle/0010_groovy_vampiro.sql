PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`number` integer,
	`title` text,
	`our_position` text,
	`their_position` text,
	`evidence` text,
	`law_refs` text,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_disputes`("id", "case_id", "number", "title", "our_position", "their_position", "evidence", "law_refs") SELECT "id", "case_id", "number", "title", "our_position", "their_position", "evidence", "law_refs" FROM `disputes`;--> statement-breakpoint
DROP TABLE `disputes`;--> statement-breakpoint
ALTER TABLE `__new_disputes` RENAME TO `disputes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `files` DROP COLUMN `extracted_claims`;