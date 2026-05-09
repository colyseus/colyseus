/**
 * One-line factories for pg-flavored Colyseus tables. Mirror of sqlite.ts.
 *
 *   import { tables } from '@colyseus/database';
 *   import { text, integer } from 'drizzle-orm/pg-core';
 *
 *   const users = tables.pg.users('users', {
 *     displayName: text('display_name'),
 *     level: integer('level').notNull().default(1),
 *   });
 */
import { pgTable, primaryKey } from 'drizzle-orm/pg-core';
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
  adminAuditColumns,
} from '../schemas/pg.ts';

export const pg = {
  users: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    pgTable(name, { ...userColumns, ...(extras as E) }),

  configs: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    pgTable(name, { ...configColumns, ...(extras as E) }),

  cloudSaves: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    pgTable(name, { ...cloudSaveColumns, ...(extras as E) }, (table) => [
      primaryKey({ columns: [table.userId, table.slot] }),
    ]),

  leaderboards: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    pgTable(name, { ...leaderboardColumns, ...(extras as E) }),

  leaderboardEntries: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    pgTable(name, { ...leaderboardEntryColumns, ...(extras as E) }, (table) => [
      primaryKey({ columns: [table.boardId, table.userId, table.season] }),
    ]),

  items: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    pgTable(name, { ...itemColumns, ...(extras as E) }),

  playerItems: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    pgTable(name, { ...playerItemColumns, ...(extras as E) }, (table) => [
      primaryKey({ columns: [table.userId, table.itemId] }),
    ]),

  timedEvents: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    pgTable(name, { ...timedEventColumns, ...(extras as E) }),

  analyticsEvents: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    pgTable(name, { ...analyticsEventColumns, ...(extras as E) }),

  userRoles: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    pgTable(name, { ...userRoleColumns, ...(extras as E) }),

  modAssignments: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    pgTable(name, { ...modAssignmentColumns, ...(extras as E) }, (table) => [
      primaryKey({ columns: [table.userId, table.collection] }),
    ]),

  userNotes: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    pgTable(name, { ...userNoteColumns, ...(extras as E) }),

  adminAudit: <E extends Record<string, any> = {}>(name: string, extras?: E) =>
    pgTable(name, { ...adminAuditColumns, ...(extras as E) }),
};
