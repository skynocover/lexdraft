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
--> statement-breakpoint
CREATE TABLE `briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`template_id` text,
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
	`plaintiff` text,
	`defendant` text,
	`client_role` text,
	`case_instructions` text,
	`law_refs` text,
	`timeline` text,
	`undisputed_facts` text,
	`information_gaps` text,
	`case_summary` text,
	`division` text,
	`template_id` text,
	`disputes_analyzed_at` text,
	`timeline_analyzed_at` text,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `damages` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`category` text,
	`description` text,
	`amount` integer NOT NULL,
	`basis` text,
	`dispute_id` text,
	`evidence_refs` text,
	`created_at` text,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dispute_id`) REFERENCES `disputes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `disputes` (
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
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`filename` text NOT NULL,
	`r2_key` text NOT NULL,
	`file_size` integer,
	`mime_type` text,
	`status` text DEFAULT 'pending',
	`category` text,
	`doc_date` text,
	`full_text` text,
	`content_md` text,
	`summary` text,
	`created_at` text,
	`updated_at` text,
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
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text,
	`content_md` text,
	`brief_mode` text,
	`is_default` integer DEFAULT 0,
	`created_at` text,
	`updated_at` text
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