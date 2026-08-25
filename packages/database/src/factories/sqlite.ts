/**
 * One-line factories for sqlite-flavored Colyseus tables.
 *
 *   import { tables } from '@colyseus/database';
 *   import { text, integer } from 'drizzle-orm/sqlite-core';
 *
 *   const users = tables.sqlite.users('users', {
 *     displayName: text('display_name'),
 *     level: integer('level').notNull().default(1),
 *   });
 *
 * Equivalent to:
 *
 *   import { sqliteTable } from 'drizzle-orm/sqlite-core';
 *   import { columns } from '@colyseus/database';
 *
 *   const users = sqliteTable('users', {
 *     ...columns.sqlite.users,
 *     displayName: text('display_name'),
 *     level: integer('level').notNull().default(1),
 *   });
 *
 * Tables with composite primary keys (cloudSaves, leaderboardEntries)
 * get the right primaryKey() constraint applied automatically.
 */
import { sqliteTable, primaryKey } from 'drizzle-orm/sqlite-core';
import {
  userColumns,
  configColumns,
  cloudSaveColumns,
  leaderboardColumns,
  leaderboardEntryColumns,
  analyticsEventColumns,
  roleColumns,
  userNoteColumns,
  adminAuditColumns,
  roomCacheColumns,
} from '../schemas/sqlite.ts';

export const sqlite = {
  users: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...userColumns, ...(extras as E) }),

  configs: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...configColumns, ...(extras as E) }),

  cloudSaves: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...cloudSaveColumns, ...(extras as E) }, (table) => [
      primaryKey({ columns: [table.userId, table.slot] }),
    ]),

  leaderboards: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...leaderboardColumns, ...(extras as E) }),

  leaderboardEntries: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...leaderboardEntryColumns, ...(extras as E) }, (table) => [
      primaryKey({ columns: [table.boardId, table.userId, table.season] }),
    ]),

  analyticsEvents: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...analyticsEventColumns, ...(extras as E) }),

  roles: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...roleColumns, ...(extras as E) }),

  userNotes: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...userNoteColumns, ...(extras as E) }),

  adminAudit: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...adminAuditColumns, ...(extras as E) }),

  roomCaches: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...roomCacheColumns, ...(extras as E) }),
};
