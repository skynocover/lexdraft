CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`side` text NOT NULL,
	`claim_type` text NOT NULL,
	`statement` text NOT NULL,
	`assigned_section` text,
	`dispute_id` text,
	`responds_to` text,
	`created_at` text,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dispute_id`) REFERENCES `disputes`(`id`) ON UPDATE no action ON DELETE no action
);
