CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`snapshot` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
ALTER TABLE `recipes` ADD `params` text DEFAULT '[]' NOT NULL;