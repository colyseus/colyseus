CREATE TABLE `colyseus_banned_addresses` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`reason` text,
	`until` integer,
	`created_by` text,
	`created_at` integer NOT NULL
);
