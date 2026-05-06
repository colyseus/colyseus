import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { generateId } from '@colyseus/core';

// ---------------------------------------------------------------------------
// Spreadable base columns — users can spread these into their own sqliteTable
// calls to extend with custom fields.
//
//   import { columns } from '@colyseus/database';
//   const users = sqliteTable('my_users', {
//     ...columns.sqlite.users,
//     displayName: text('display_name'),
//   });
// ---------------------------------------------------------------------------

export const userColumns = {
  id: text('id').primaryKey().$defaultFn(() => generateId(21)),
  email: text('email'),
  passwordHash: text('password_hash'),
  anonymous: integer('anonymous', { mode: 'boolean' as const }).notNull().default(true),
  anonymousId: text('anonymous_id'),
  createdAt: integer('created_at', { mode: 'timestamp' as const }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' as const }).notNull().default(sql`(unixepoch())`),
};

export const configColumns = {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' as const }),
  version: integer('version').notNull().default(1),
  updatedAt: integer('updated_at', { mode: 'timestamp' as const }).notNull().default(sql`(unixepoch())`),
};

export const cloudSaveColumns = {
  userId: text('user_id').notNull(),
  slot: integer('slot').notNull(),
  version: integer('version').notNull().default(1),
  data: text('data', { mode: 'json' as const }),
  createdAt: integer('created_at', { mode: 'timestamp' as const }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' as const }).notNull().default(sql`(unixepoch())`),
};

export const leaderboardColumns = {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
};

export const leaderboardEntryColumns = {
  boardId: text('board_id').notNull(),
  userId: text('user_id').notNull(),
  season: text('season').notNull().default('global'),
  score: integer('score').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' as const }).notNull().default(sql`(unixepoch())`),
};

export const itemColumns = {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('misc'),
  meta: text('meta', { mode: 'json' as const }),
};

export const playerItemColumns = {
  userId: text('user_id').notNull(),
  itemId: text('item_id').notNull(),
  qty: integer('qty').notNull().default(1),
  acquiredAt: integer('acquired_at', { mode: 'timestamp' as const }).notNull().default(sql`(unixepoch())`),
};

export const timedEventColumns = {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  startsAt: integer('starts_at', { mode: 'timestamp' as const }).notNull(),
  endsAt: integer('ends_at', { mode: 'timestamp' as const }).notNull(),
  payload: text('payload', { mode: 'json' as const }),
};

// ---------------------------------------------------------------------------
// Default table instances — used when the user does NOT provide custom schemas
// ---------------------------------------------------------------------------

export const colyseusUsers = sqliteTable('colyseus_users', { ...userColumns });

export const colyseusConfigs = sqliteTable('colyseus_configs', { ...configColumns });

export const colyseusCloudSaves = sqliteTable('colyseus_cloud_saves', { ...cloudSaveColumns }, (table) => [
  primaryKey({ columns: [table.userId, table.slot] }),
]);

export const colyseusLeaderboards = sqliteTable('colyseus_leaderboards', { ...leaderboardColumns });

export const colyseusLeaderboardEntries = sqliteTable(
  'colyseus_leaderboard_entries',
  { ...leaderboardEntryColumns },
  (table) => [primaryKey({ columns: [table.boardId, table.userId, table.season] })],
);

export const colyseusItems = sqliteTable('colyseus_items', { ...itemColumns });

export const colyseusPlayerItems = sqliteTable(
  'colyseus_player_items',
  { ...playerItemColumns },
  (table) => [primaryKey({ columns: [table.userId, table.itemId] })],
);

export const colyseusTimedEvents = sqliteTable('colyseus_timed_events', { ...timedEventColumns });
