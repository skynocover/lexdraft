CREATE TABLE `brief_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`brief_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`label` text NOT NULL,
	`content_structured` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`brief_id`) REFERENCES `briefs`(`id`) ON UPDATE no action ON DELETE no action
);
