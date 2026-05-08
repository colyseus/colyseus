ALTER TABLE `users` ADD COLUMN `banned_until` integer;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `banned_reason` text;
