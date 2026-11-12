CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`path` text NOT NULL,
	`remote_path` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
