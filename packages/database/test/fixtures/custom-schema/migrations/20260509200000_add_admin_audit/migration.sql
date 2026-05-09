CREATE TABLE `colyseus_admin_audit` (
	`id` text PRIMARY KEY,
	`operator_id` text,
	`action` text NOT NULL,
	`resource` text NOT NULL,
	`target_id` text,
	`payload` text,
	`created_at` integer NOT NULL
);
