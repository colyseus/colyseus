/**
 * Re-exports the default sqlite tables under their canonical short names
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
 *   import { text } from 'drizzle-orm/sqlite-core';
 *
 *   // Custom — overrides the default users table
 *   export const users = tables.sqlite.users('users', {
 *     displayName: text('display_name'),
 *   });
 *
 *   // Defaults — re-exported as-is so drizzle-kit picks them up
 *   export {
 *     configs, cloudSaves, leaderboards, leaderboardEntries,
 *     items, playerItems, timedEvents, analyticsEvents,
 *     userRoles, modAssignments,
 *   } from '@colyseus/database/sqlite-defaults';
 *
 *   // drizzle.config.ts
 *   import { defineConfig } from 'drizzle-kit';
 *   export default defineConfig({
 *     dialect: 'sqlite',
 *     schema: './db/schema.ts',
 *     out: './drizzle',
 *     dbCredentials: { url: 'colyseus.db' },
 *   });
 *
 *   // app.ts
 *   import * as schema from './db/schema.ts';
 *   const db = new GameDatabase({
 *     connectionString: 'colyseus.db',
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
} from './schemas/sqlite.ts';
