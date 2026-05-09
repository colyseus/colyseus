export { GameDatabase } from './GameDatabase.ts';
export type { GameDatabaseOptions } from './GameDatabase.ts';

export { VersionConflictError } from './services/CloudSaveService.ts';
export type { LeaderboardEntry } from './services/LeaderboardsService.ts';
export type { Item, PlayerItem } from './services/ItemsService.ts';
export type { TimedEvent } from './services/TimedEventsService.ts';
export type { RetentionResult, FunnelStep } from './services/AnalyticsService.ts';
export type { Role, Action } from './services/ModerationService.ts';
export { defineSegment, createSegmentDefiner } from './segments.ts';
export type { RelationDefinition, RelationKind } from './relations-meta.ts';
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
  itemColumns as sqliteItemColumns,
  playerItemColumns as sqlitePlayerItemColumns,
  timedEventColumns as sqliteTimedEventColumns,
  analyticsEventColumns as sqliteAnalyticsEventColumns,
  userRoleColumns as sqliteUserRoleColumns,
  modAssignmentColumns as sqliteModAssignmentColumns,
  userNoteColumns as sqliteUserNoteColumns,
} from './schemas/sqlite.ts';
export {
  userColumns as pgUserColumns,
  configColumns as pgConfigColumns,
  cloudSaveColumns as pgCloudSaveColumns,
  leaderboardColumns as pgLeaderboardColumns,
  leaderboardEntryColumns as pgLeaderboardEntryColumns,
  itemColumns as pgItemColumns,
  playerItemColumns as pgPlayerItemColumns,
  timedEventColumns as pgTimedEventColumns,
  analyticsEventColumns as pgAnalyticsEventColumns,
  userRoleColumns as pgUserRoleColumns,
  modAssignmentColumns as pgModAssignmentColumns,
  userNoteColumns as pgUserNoteColumns,
} from './schemas/pg.ts';

// Namespaced columns export: columns.sqlite.users, columns.pg.users, etc.
import {
  userColumns as sqliteUsers,
  configColumns as sqliteConfigs,
  cloudSaveColumns as sqliteCloudSaves,
  leaderboardColumns as sqliteLeaderboards,
  leaderboardEntryColumns as sqliteLeaderboardEntries,
  itemColumns as sqliteItems,
  playerItemColumns as sqlitePlayerItems,
  timedEventColumns as sqliteTimedEvents,
  analyticsEventColumns as sqliteAnalyticsEvents,
  userRoleColumns as sqliteUserRoles,
  modAssignmentColumns as sqliteModAssignments,
  userNoteColumns as sqliteUserNotes,
} from './schemas/sqlite.ts';
import {
  userColumns as pgUsers,
  configColumns as pgConfigs,
  cloudSaveColumns as pgCloudSaves,
  leaderboardColumns as pgLeaderboards,
  leaderboardEntryColumns as pgLeaderboardEntries,
  itemColumns as pgItems,
  playerItemColumns as pgPlayerItems,
  timedEventColumns as pgTimedEvents,
  analyticsEventColumns as pgAnalyticsEvents,
  userRoleColumns as pgUserRoles,
  modAssignmentColumns as pgModAssignments,
  userNoteColumns as pgUserNotes,
} from './schemas/pg.ts';

export const columns = {
  sqlite: {
    users: sqliteUsers,
    configs: sqliteConfigs,
    cloudSaves: sqliteCloudSaves,
    leaderboards: sqliteLeaderboards,
    leaderboardEntries: sqliteLeaderboardEntries,
    items: sqliteItems,
    playerItems: sqlitePlayerItems,
    timedEvents: sqliteTimedEvents,
    analyticsEvents: sqliteAnalyticsEvents,
    userRoles: sqliteUserRoles,
    modAssignments: sqliteModAssignments,
    userNotes: sqliteUserNotes,
  },
  pg: {
    users: pgUsers,
    configs: pgConfigs,
    cloudSaves: pgCloudSaves,
    leaderboards: pgLeaderboards,
    leaderboardEntries: pgLeaderboardEntries,
    items: pgItems,
    playerItems: pgPlayerItems,
    timedEvents: pgTimedEvents,
    analyticsEvents: pgAnalyticsEvents,
    userRoles: pgUserRoles,
    modAssignments: pgModAssignments,
    userNotes: pgUserNotes,
  },
};

// Per-dialect table factories. Mirrors the `columns.{sqlite,pg}.*` shape:
//
//   const users = tables.sqlite.users('users', { displayName: text(...) });
//   const items = tables.pg.items('items', { rarity: text(...) });
//
// One-line replacement for the manual sqliteTable/pgTable + spread pattern.
import { sqlite } from './factories/sqlite.ts';
import { pg } from './factories/pg.ts';
export const tables = { sqlite, pg };
