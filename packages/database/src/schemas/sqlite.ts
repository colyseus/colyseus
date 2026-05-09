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
  // Ban state — null bannedUntil means not banned. A future timestamp
  // means banned through that instant; the AuthService.findByEmail check
  // rejects sign-in while bannedUntil > now.
  bannedUntil: integer('banned_until', { mode: 'timestamp' as const }),
  bannedReason: text('banned_reason'),
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

export const analyticsEventColumns = {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id'),
  name: text('name').notNull(),
  props: text('props', { mode: 'json' as const }),
  ts: integer('ts', { mode: 'timestamp' as const }).notNull().default(sql`(unixepoch())`),
};

export const userRoleColumns = {
  userId: text('user_id').primaryKey(),
  role: text('role', { enum: ['admin', 'mod', 'user'] as const }).notNull(),
};

export const modAssignmentColumns = {
  userId: text('user_id').notNull(),
  collection: text('collection').notNull(),
};

/**
 * IP / device bans, separate from per-user bans. Lets operators block
 * a connection-source identifier (an IP, a device fingerprint, etc.)
 * regardless of which account is signing in. The `kind` column is
 * a free-form tag — `'ip'` and `'device'` are the conventional
 * values, but games can introduce their own (e.g. `'install_id'`).
 *
 * (kind, value) is the lookup key; uniqueness is the caller's
 * responsibility — re-banning the same address overwrites by design,
 * use the service's ban() method.
 */
export const bannedAddressColumns = {
  id: text('id').primaryKey().$defaultFn(() => generateId(21)),
  kind: text('kind').notNull(),
  value: text('value').notNull(),
  reason: text('reason'),
  until: integer('until', { mode: 'timestamp_ms' as const }),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' as const })
    .notNull()
    .$defaultFn(() => new Date()),
};

/**
 * Admin audit log. Every Create / Update / Delete / custom action that
 * passes through `adminEndpoints` records a row here so operators can
 * answer "who edited this config / banned which player". The table is
 * append-only; deletion is a separate, opt-in operation (e.g. a cron
 * that prunes rows older than N days).
 *
 * `payload` is opaque JSON — its shape depends on the action:
 *   create → { row }
 *   update → { before, after }
 *   delete → { row }
 *   custom → { name, args, result }
 */
export const adminAuditColumns = {
  id: text('id').primaryKey().$defaultFn(() => generateId(21)),
  operatorId: text('operator_id'),
  action: text('action').notNull(),
  resource: text('resource').notNull(),
  targetId: text('target_id'),
  payload: text('payload', { mode: 'json' as const }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' as const })
    .notNull()
    .$defaultFn(() => new Date()),
};

/**
 * Free-form admin notes attached to a user. Append-only by convention
 * (the service exposes create + delete; no edit), so an audit trail of
 * "Refunded once 2026-04 — Endel" remains stable. authorId is the
 * operator who wrote the note.
 *
 * createdAt uses `timestamp_ms` mode so notes added back-to-back keep
 * a stable order — `unixepoch()` only has second precision, which made
 * "newest first" tests flake.
 */
export const userNoteColumns = {
  id: text('id').primaryKey().$defaultFn(() => generateId(21)),
  userId: text('user_id').notNull(),
  authorId: text('author_id'),
  text: text('text').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' as const })
    .notNull()
    .$defaultFn(() => new Date()),
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

export const colyseusAnalyticsEvents = sqliteTable('colyseus_analytics_events', { ...analyticsEventColumns });

export const colyseusUserRoles = sqliteTable('colyseus_user_roles', { ...userRoleColumns });

export const colyseusModAssignments = sqliteTable(
  'colyseus_mod_assignments',
  { ...modAssignmentColumns },
  (table) => [primaryKey({ columns: [table.userId, table.collection] })],
);

export const colyseusUserNotes = sqliteTable('colyseus_user_notes', { ...userNoteColumns });

export const colyseusAdminAudit = sqliteTable('colyseus_admin_audit', { ...adminAuditColumns });

export const colyseusBannedAddresses = sqliteTable('colyseus_banned_addresses', { ...bannedAddressColumns });
