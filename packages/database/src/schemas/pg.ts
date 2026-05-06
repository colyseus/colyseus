import { pgTable, text, boolean, integer, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { generateId } from '@colyseus/core';

// ---------------------------------------------------------------------------
// Spreadable base columns — users can spread these into their own pgTable
// calls to extend with custom fields.
//
//   import { columns } from '@colyseus/database';
//   const users = pgTable('my_users', {
//     ...columns.pg.users,
//     displayName: text('display_name'),
//   });
// ---------------------------------------------------------------------------

export const userColumns = {
  id: text('id').primaryKey().$defaultFn(() => generateId(21)),
  email: text('email'),
  passwordHash: text('password_hash'),
  anonymous: boolean('anonymous').notNull().default(true),
  anonymousId: text('anonymous_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
};

export const configColumns = {
  key: text('key').primaryKey(),
  value: jsonb('value'),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
};

export const cloudSaveColumns = {
  userId: text('user_id').notNull(),
  slot: integer('slot').notNull(),
  version: integer('version').notNull().default(1),
  data: jsonb('data'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
  createdAt: timestamp('created_at').notNull().defaultNow(),
};

// ---------------------------------------------------------------------------
// Default table instances — used when the user does NOT provide custom schemas
// ---------------------------------------------------------------------------

export const colyseusUsers = pgTable('colyseus_users', { ...userColumns });

export const colyseusConfigs = pgTable('colyseus_configs', { ...configColumns });

export const colyseusCloudSaves = pgTable('colyseus_cloud_saves', { ...cloudSaveColumns }, (table) => [
  primaryKey({ columns: [table.userId, table.slot] }),
]);

export const colyseusLeaderboards = pgTable('colyseus_leaderboards', { ...leaderboardColumns });

export const colyseusLeaderboardEntries = pgTable(
  'colyseus_leaderboard_entries',
  { ...leaderboardEntryColumns },
  (table) => [primaryKey({ columns: [table.boardId, table.userId, table.season] })],
);
