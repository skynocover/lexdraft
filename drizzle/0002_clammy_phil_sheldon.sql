CREATE TABLE `timeline_events` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`source_file` text,
	`is_critical` integer DEFAULT false,
	`created_at` text,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
