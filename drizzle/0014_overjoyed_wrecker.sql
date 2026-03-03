CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text,
	`content_md` text,
	`is_default` integer DEFAULT 0,
	`created_at` text,
	`updated_at` text
);
