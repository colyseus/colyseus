/**
 * Re-exports the default postgres tables under their canonical short names
 * (`users`, `configs`, ...) so a consumer's own schema file can compose
 * them with their custom tables in a single line.
 *
 * Designed as the schema entrypoint for `drizzle-kit generate` when you
 * customize one or more tables. drizzle-kit walks the file's exports
 * looking for drizzle Table objects — re-exports here count.
 *
 * @example
 *   // db/schema.ts
 *   import { tables } from '@colyseus/database';
 *   import { text } from 'drizzle-orm/pg-core';
 *
 *   // Custom — overrides the default users table
 *   export const users = tables.pg.users('users', {
 *     displayName: text('display_name'),
 *   });
 *
 *   // Defaults — re-exported as-is so drizzle-kit picks them up
 *   export {
 *     configs, cloudSaves, leaderboards, leaderboardEntries,
 *     items, playerItems, timedEvents, analyticsEvents,
 *     userRoles, modAssignments,
 *   } from '@colyseus/database/pg-defaults';
 *
 *   // drizzle.config.ts
 *   import { defineConfig } from 'drizzle-kit';
 *   export default defineConfig({
 *     dialect: 'postgresql',
 *     schema: './db/schema.ts',
 *     out: './drizzle',
 *     dbCredentials: { url: process.env.DATABASE_URL! },
 *   });
 *
 *   // app.ts
 *   import * as schema from './db/schema.ts';
 *   const db = new GameDatabase({
 *     dialect: 'pg',
 *     connectionString: process.env.DATABASE_URL,
 *     schemas: schema,
 *     migrations: { files: './drizzle' },
 *   });
 */
export {
  colyseusUsers as users,
  colyseusConfigs as configs,
  colyseusCloudSaves as cloudSaves,
  colyseusLeaderboards as leaderboards,
  colyseusLeaderboardEntries as leaderboardEntries,
  colyseusItems as items,
  colyseusPlayerItems as playerItems,
  colyseusTimedEvents as timedEvents,
  colyseusAnalyticsEvents as analyticsEvents,
  colyseusUserRoles as userRoles,
  colyseusModAssignments as modAssignments,
  colyseusUserNotes as userNotes,
  colyseusAdminAudit as adminAudit,
} from './schemas/pg.ts';
