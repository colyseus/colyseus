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
 * Tables with composite primary keys (cloudSaves, leaderboardEntries,
 * playerItems, modAssignments) get the right primaryKey() constraint
 * applied automatically.
 */
import { sqliteTable, primaryKey } from 'drizzle-orm/sqlite-core';
import {
  userColumns,
  configColumns,
  cloudSaveColumns,
  leaderboardColumns,
  leaderboardEntryColumns,
  itemColumns,
  playerItemColumns,
  timedEventColumns,
  analyticsEventColumns,
  userRoleColumns,
  modAssignmentColumns,
  userNoteColumns,
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

  items: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...itemColumns, ...(extras as E) }),

  playerItems: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...playerItemColumns, ...(extras as E) }, (table) => [
      primaryKey({ columns: [table.userId, table.itemId] }),
    ]),

  timedEvents: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...timedEventColumns, ...(extras as E) }),

  analyticsEvents: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...analyticsEventColumns, ...(extras as E) }),

  userRoles: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...userRoleColumns, ...(extras as E) }),

  modAssignments: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...modAssignmentColumns, ...(extras as E) }, (table) => [
      primaryKey({ columns: [table.userId, table.collection] }),
    ]),

  userNotes: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    sqliteTable(name, { ...userNoteColumns, ...(extras as E) }),
};
