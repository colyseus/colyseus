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
import { pgTable, primaryKey, type PgTableExtraConfigValue } from 'drizzle-orm/pg-core';
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
} from '../schemas/pg.ts';

/**
 * Optional third factory argument, same shape as pgTable's: receives the built
 * columns (base + extras) and returns indexes / checks / unique constraints.
 * Merged after the built-in composite primary key where one exists.
 */
type ExtraConfig<C extends Record<string, any>> =
  (table: BuildColumns<string, C, 'pg'>) => PgTableExtraConfigValue[];

export const pg = {
  users: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof userColumns & E>) =>
    pgTable(name, { ...userColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),

  configs: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof configColumns & E>) =>
    pgTable(name, { ...configColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),

  cloudSaves: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof cloudSaveColumns & E>) =>
    pgTable(name, { ...cloudSaveColumns, ...(extras as E) }, (table) => [
      primaryKey({ columns: [table.userId, table.slot] }),
      ...(extraConfig?.(table as any) ?? []),
    ]),

  leaderboards: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof leaderboardColumns & E>) =>
    pgTable(name, { ...leaderboardColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),

  leaderboardEntries: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof leaderboardEntryColumns & E>) =>
    pgTable(name, { ...leaderboardEntryColumns, ...(extras as E) }, (table) => [
      primaryKey({ columns: [table.boardId, table.userId, table.season] }),
      ...(extraConfig?.(table as any) ?? []),
    ]),

  analyticsEvents: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof analyticsEventColumns & E>) =>
    pgTable(name, { ...analyticsEventColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),

  roles: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof roleColumns & E>) =>
    pgTable(name, { ...roleColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),

  userNotes: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof userNoteColumns & E>) =>
    pgTable(name, { ...userNoteColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),

  adminAudit: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof adminAuditColumns & E>) =>
    pgTable(name, { ...adminAuditColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),

  roomCaches: <E extends Record<string, any> = {}>(name: string, extras?: E, extraConfig?: ExtraConfig<typeof roomCacheColumns & E>) =>
    pgTable(name, { ...roomCacheColumns, ...(extras as E) }, (table) => extraConfig?.(table as any) ?? []),
};
