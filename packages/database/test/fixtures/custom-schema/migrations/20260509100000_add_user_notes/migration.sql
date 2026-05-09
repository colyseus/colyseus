CREATE TABLE `colyseus_user_notes` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`author_id` text,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
