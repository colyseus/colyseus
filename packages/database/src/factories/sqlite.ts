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
import { sqliteTable, primaryKey, type SQLiteTableExtraConfigValue } from 'drizzle-orm/sqlite-core';
import type { BuildColumns } from 'drizzle-orm';
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

/**
 * Optional third factory argument, same shape as sqliteTable's: receives the built
 * columns (base + extras) and returns indexes / checks / unique constraints.
 * Merged after the built-in composite primary key where one exists.
 */
type ExtraConfig<C extends Record<string, any>> =
  (table: BuildColumns<string, C, 'sqlite'>) => SQLiteTableExtraConfigValue[];

export const sqlite = {
  users: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof userColumns & E>) =>
    sqliteTable(name, { ...userColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),

  configs: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof configColumns & E>) =>
    sqliteTable(name, { ...configColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),

  cloudSaves: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof cloudSaveColumns & E>) =>
    sqliteTable(name, { ...cloudSaveColumns, ...(extras as E) }, (table) => [
      primaryKey({ columns: [table.userId, table.slot] }),
      ...(extraConfig?.(table as any) ?? []),
    ]),

  leaderboards: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof leaderboardColumns & E>) =>
    sqliteTable(name, { ...leaderboardColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),

  leaderboardEntries: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof leaderboardEntryColumns & E>) =>
    sqliteTable(name, { ...leaderboardEntryColumns, ...(extras as E) }, (table) => [
      primaryKey({ columns: [table.boardId, table.userId, table.season] }),
      ...(extraConfig?.(table as any) ?? []),
    ]),

  analyticsEvents: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof analyticsEventColumns & E>) =>
    sqliteTable(name, { ...analyticsEventColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),

  roles: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof roleColumns & E>) =>
    sqliteTable(name, { ...roleColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),

  userNotes: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof userNoteColumns & E>) =>
    sqliteTable(name, { ...userNoteColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),

  adminAudit: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof adminAuditColumns & E>) =>
    sqliteTable(name, { ...adminAuditColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),

  roomCaches: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof roomCacheColumns & E>) =>
    sqliteTable(name, { ...roomCacheColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),
};
