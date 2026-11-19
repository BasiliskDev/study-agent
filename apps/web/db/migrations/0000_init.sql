CREATE TABLE `attempts` (
	`problem_set_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`correct` integer NOT NULL,
	`answered_at` integer NOT NULL,
	PRIMARY KEY(`problem_set_id`, `problem_id`, `answered_at`),
	FOREIGN KEY (`problem_set_id`) REFERENCES `problem_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`canvas_id` integer NOT NULL,
	`name` text NOT NULL,
	`course_code` text NOT NULL,
	`term` text,
	`subject` text DEFAULT 'other' NOT NULL,
	`subject_locked` integer DEFAULT false NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`syllabus_text` text,
	`last_synced_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `courses_user_canvas` ON `courses` (`user_id`,`canvas_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`course_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`log` text DEFAULT '[]' NOT NULL,
	`result_id` text,
	`usage` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `materials` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`kind` text NOT NULL,
	`canvas_key` text NOT NULL,
	`title` text NOT NULL,
	`module_name` text,
	`position` integer DEFAULT 0 NOT NULL,
	`unlock_at` text,
	`content_type` text,
	`size_bytes` integer,
	`pages` integer,
	`text_content` text,
	`blob_key` text,
	`anthropic_file_id` text,
	`source_version` text,
	`content_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `materials_course_key` ON `materials` (`course_id`,`kind`,`canvas_key`);--> statement-breakpoint
CREATE INDEX `materials_course` ON `materials` (`course_id`);--> statement-breakpoint
CREATE TABLE `problem_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`title` text NOT NULL,
	`prompt` text,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`checks` text,
	`job_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `problem_sets_course` ON `problem_sets` (`course_id`);--> statement-breakpoint
CREATE TABLE `topic_outlines` (
	`course_id` text PRIMARY KEY NOT NULL,
	`outline` text NOT NULL,
	`source_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`canvas_base_url` text,
	`canvas_token_enc` text,
	`canvas_user_name` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
