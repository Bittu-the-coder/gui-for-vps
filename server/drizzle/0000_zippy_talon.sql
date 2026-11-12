CREATE TABLE `known_hosts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_id` text NOT NULL,
	`key_type` text NOT NULL,
	`fingerprint` text NOT NULL,
	`first_seen` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `known_hosts_server_idx` ON `known_hosts` (`server_id`);--> statement-breakpoint
CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 22 NOT NULL,
	`username` text NOT NULL,
	`auth_type` text NOT NULL,
	`color` text DEFAULT '#0ea5e9' NOT NULL,
	`credential` blob NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vault_meta` (
	`id` integer PRIMARY KEY NOT NULL,
	`salt` text NOT NULL,
	`params` text NOT NULL,
	`canary` text NOT NULL
);
