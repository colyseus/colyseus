CREATE TABLE IF NOT EXISTS "colyseus_admin_audit" (
  "id" text PRIMARY KEY NOT NULL,
  "operator_id" text,
  "action" text NOT NULL,
  "resource" text NOT NULL,
  "target_id" text,
  "payload" text,
  "created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "colyseus_analytics_events" (
  "id" integer PRIMARY KEY NOT NULL,
  "user_id" text,
  "name" text NOT NULL,
  "props" text,
  "ts" integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "colyseus_cloud_saves" (
  "user_id" text NOT NULL,
  "slot" integer NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "data" text,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("user_id", "slot")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "colyseus_configs" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text,
  "version" integer NOT NULL DEFAULT 1,
  "updated_at" integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "colyseus_leaderboard_entries" (
  "board_id" text NOT NULL,
  "user_id" text NOT NULL,
  "season" text NOT NULL DEFAULT 'global',
  "score" integer NOT NULL,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("board_id", "user_id", "season")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "colyseus_leaderboards" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "colyseus_roles" (
  "user_id" text PRIMARY KEY NOT NULL,
  "role" text NOT NULL,
  "scopes" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "colyseus_user_notes" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "author_id" text,
  "text" text NOT NULL,
  "created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text,
  "password_hash" text,
  "anonymous" integer NOT NULL DEFAULT true,
  "anonymous_id" text,
  "created_at" integer NOT NULL DEFAULT (unixepoch()),
  "updated_at" integer NOT NULL DEFAULT (unixepoch()),
  "banned_until" integer,
  "banned_reason" text,
  "token_version" integer NOT NULL DEFAULT 0,
  "display_name" text,
  "level" integer DEFAULT 1
);
