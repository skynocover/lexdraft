CREATE TABLE `briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`brief_type` text NOT NULL,
	`title` text,
	`content_structured` text,
	`version` integer DEFAULT 1,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`case_number` text,
	`court` text,
	`case_type` text,
	`plaintiff` text,
	`defendant` text,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`brief_id` text,
	`number` integer,
	`title` text,
	`our_position` text,
	`their_position` text,
	`evidence` text,
	`law_refs` text,
	`priority` integer DEFAULT 0,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brief_id`) REFERENCES `briefs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`filename` text NOT NULL,
	`r2_key` text NOT NULL,
	`file_size` integer,
	`mime_type` text,
	`status` text DEFAULT 'pending',
	`category` text,
	`doc_type` text,
	`doc_date` text,
	`full_text` text,
	`summary` text,
	`extracted_claims` text,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `law_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`law_name` text,
	`article` text,
	`title` text,
	`full_text` text,
	`highlight_ranges` text,
	`usage_count` integer DEFAULT 0,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`created_at` text,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);