CREATE TABLE `exhibits` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`file_id` text NOT NULL,
	`prefix` text,
	`number` integer,
	`doc_type` text DEFAULT '影本',
	`description` text,
	`created_at` text,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exhibits_case_file_unique` ON `exhibits` (`case_id`, `file_id`);
