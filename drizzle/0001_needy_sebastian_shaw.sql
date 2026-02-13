CREATE TABLE `damages` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`category` text NOT NULL,
	`description` text,
	`amount` integer NOT NULL,
	`basis` text,
	`evidence_refs` text,
	`dispute_id` text,
	`created_at` text,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dispute_id`) REFERENCES `disputes`(`id`) ON UPDATE no action ON DELETE no action
);
