CREATE TABLE `ai_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`provider` text DEFAULT 'anthropic' NOT NULL,
	`model` text DEFAULT 'claude-sonnet-5-5' NOT NULL,
	`base_url` text DEFAULT '' NOT NULL,
	`api_key` blob
);
