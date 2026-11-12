CREATE TABLE `history` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`action_id` text NOT NULL,
	`title` text NOT NULL,
	`params` text,
	`commands` text NOT NULL,
	`risk` text NOT NULL,
	`exit_code` integer,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`output_tail` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
