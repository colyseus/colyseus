export { GameDatabase } from './GameDatabase.ts';
export type { GameDatabaseOptions } from './GameDatabase.ts';
export { POSTGRES_MAX_INTEGER } from './constants.ts';

// Matchmaking driver — surfaced from the main entry so it can be used as
// `import { DatabaseDriver } from '@colyseus/database'`. Still available
// via the `./driver` subpath for bundle-lean setups.
export { DatabaseDriver } from './driver.ts';
export type {
  DatabaseDriverOptions,
  DatabaseDriverGameDatabaseOptions,
  DatabaseDriverDrizzleOptions,
} from './driver.ts';
export { defineConfigs } from './configs.ts';
export type { ConfigsRegistry, ConfigValue, AllConfigs } from './configs.ts';

export { VersionConflictError } from './services/CloudSaveService.ts';
export type { LeaderboardEntry } from './services/LeaderboardsService.ts';
export type { Role, Action } from './services/ModerationService.ts';
export { diffRows } from './services/AuditService.ts';
export type { AuditEntry, AuditAction } from './services/AuditService.ts';
export { defineSegment, createSegmentDefiner } from './segments.ts';
export type { RelationDefinition, RelationKind } from './relations-meta.ts';
export { resolveFkLayout } from './relations-meta.ts';
export type {
  SegmentDefinition,
  SegmentResolveContext,
  SegmentDefiner,
  SegmentDefineConfig,
  DrizzleFor,
} from './segments.ts';

// Spreadable base columns per dialect for user schema customization
export {
  userColumns as sqliteUserColumns,
  configColumns as sqliteConfigColumns,
  cloudSaveColumns as sqliteCloudSaveColumns,
  leaderboardColumns as sqliteLeaderboardColumns,
  leaderboardEntryColumns as sqliteLeaderboardEntryColumns,
  analyticsEventColumns as sqliteAnalyticsEventColumns,
  roleColumns as sqliteRoleColumns,
  userNoteColumns as sqliteUserNoteColumns,
  adminAuditColumns as sqliteAdminAuditColumns,
  roomCacheColumns as sqliteRoomCacheColumns,
} from './schemas/sqlite.ts';
export {
  userColumns as pgUserColumns,
  configColumns as pgConfigColumns,
  cloudSaveColumns as pgCloudSaveColumns,
  leaderboardColumns as pgLeaderboardColumns,
  leaderboardEntryColumns as pgLeaderboardEntryColumns,
  analyticsEventColumns as pgAnalyticsEventColumns,
  roleColumns as pgRoleColumns,
  userNoteColumns as pgUserNoteColumns,
  adminAuditColumns as pgAdminAuditColumns,
  roomCacheColumns as pgRoomCacheColumns,
} from './schemas/pg.ts';

// Namespaced columns export: columns.sqlite.users, columns.pg.users, etc.
import {
  userColumns as sqliteUsers,
  configColumns as sqliteConfigs,
  cloudSaveColumns as sqliteCloudSaves,
  leaderboardColumns as sqliteLeaderboards,
  leaderboardEntryColumns as sqliteLeaderboardEntries,
  analyticsEventColumns as sqliteAnalyticsEvents,
  roleColumns as sqliteRoles,
  userNoteColumns as sqliteUserNotes,
  adminAuditColumns as sqliteAdminAudit,
  roomCacheColumns as sqliteRoomCaches,
} from './schemas/sqlite.ts';
import {
  userColumns as pgUsers,
  configColumns as pgConfigs,
  cloudSaveColumns as pgCloudSaves,
  leaderboardColumns as pgLeaderboards,
  leaderboardEntryColumns as pgLeaderboardEntries,
  analyticsEventColumns as pgAnalyticsEvents,
  roleColumns as pgRoles,
  userNoteColumns as pgUserNotes,
  adminAuditColumns as pgAdminAudit,
  roomCacheColumns as pgRoomCaches,
} from './schemas/pg.ts';

export const columns = {
  sqlite: {
    users: sqliteUsers,
    configs: sqliteConfigs,
    cloudSaves: sqliteCloudSaves,
    leaderboards: sqliteLeaderboards,
    leaderboardEntries: sqliteLeaderboardEntries,
    analyticsEvents: sqliteAnalyticsEvents,
    roles: sqliteRoles,
    userNotes: sqliteUserNotes,
    adminAudit: sqliteAdminAudit,
    roomCaches: sqliteRoomCaches,
  },
  pg: {
    users: pgUsers,
    configs: pgConfigs,
    cloudSaves: pgCloudSaves,
    leaderboards: pgLeaderboards,
    leaderboardEntries: pgLeaderboardEntries,
    analyticsEvents: pgAnalyticsEvents,
    roles: pgRoles,
    userNotes: pgUserNotes,
    adminAudit: pgAdminAudit,
    roomCaches: pgRoomCaches,
  },
};

// Room plugins — surfaced from the main entry for one-import ergonomics.
// Also available individually via the `./plugins` subpath if a user wants
// to keep the main bundle lean.
export {
  AnalyticsPlugin,
  type AnalyticsPluginOptions,
  type AnalyticsLifecycleEvent,
  CloudSavesPlugin,
  type CloudSavesPluginOptions,
  LeaderboardsPlugin,
  type LeaderboardsPluginOptions,
  type UserIdResolver,
} from './plugins/index.ts';

// Per-dialect table factories. Mirrors the `columns.{sqlite,pg}.*` shape:
//
//   const users = tables.sqlite.users('users', { displayName: text(...) });
//   const board = tables.pg.leaderboards('leaderboards', { season: text(...) });
//
// One-line replacement for the manual sqliteTable/pgTable + spread pattern.
import { sqlite } from './factories/sqlite.ts';
import { pg } from './factories/pg.ts';
export const tables = { sqlite, pg };
