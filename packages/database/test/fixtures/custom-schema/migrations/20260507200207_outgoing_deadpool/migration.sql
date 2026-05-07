CREATE TABLE `colyseus_analytics_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` text,
	`name` text NOT NULL,
	`props` text,
	`ts` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `colyseus_cloud_saves` (
	`user_id` text NOT NULL,
	`slot` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`data` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `colyseus_cloud_saves_pk` PRIMARY KEY(`user_id`, `slot`)
);
--> statement-breakpoint
CREATE TABLE `colyseus_configs` (
	`key` text PRIMARY KEY,
	`value` text,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `colyseus_items` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`kind` text DEFAULT 'misc' NOT NULL,
	`meta` text
);
--> statement-breakpoint
CREATE TABLE `colyseus_leaderboard_entries` (
	`board_id` text NOT NULL,
	`user_id` text NOT NULL,
	`season` text DEFAULT 'global' NOT NULL,
	`score` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `colyseus_leaderboard_entries_pk` PRIMARY KEY(`board_id`, `user_id`, `season`)
);
--> statement-breakpoint
CREATE TABLE `colyseus_leaderboards` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `colyseus_mod_assignments` (
	`user_id` text NOT NULL,
	`collection` text NOT NULL,
	CONSTRAINT `colyseus_mod_assignments_pk` PRIMARY KEY(`user_id`, `collection`)
);
--> statement-breakpoint
CREATE TABLE `colyseus_player_items` (
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer DEFAULT 1 NOT NULL,
	`acquired_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `colyseus_player_items_pk` PRIMARY KEY(`user_id`, `item_id`)
);
--> statement-breakpoint
CREATE TABLE `colyseus_timed_events` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`payload` text
);
--> statement-breakpoint
CREATE TABLE `colyseus_user_roles` (
	`user_id` text PRIMARY KEY,
	`role` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`email` text,
	`password_hash` text,
	`anonymous` integer DEFAULT true NOT NULL,
	`anonymous_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`display_name` text,
	`level` integer DEFAULT 1
);
