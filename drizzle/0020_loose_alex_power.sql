PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_damages` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`category` text NOT NULL,
	`description` text,
	`amount` integer NOT NULL,
	`basis` text,
	`evidence_refs` text,
	`created_at` text,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_damages`("id", "case_id", "category", "description", "amount", "basis", "evidence_refs", "created_at") SELECT "id", "case_id", "category", "description", "amount", "basis", "evidence_refs", "created_at" FROM `damages`;--> statement-breakpoint
DROP TABLE `damages`;--> statement-breakpoint
ALTER TABLE `__new_damages` RENAME TO `damages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;