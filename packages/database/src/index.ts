export { GameDatabase } from './GameDatabase.ts';
export type { GameDatabaseOptions } from './GameDatabase.ts';

export { VersionConflictError } from './services/CloudSaveService.ts';
export type { LeaderboardEntry } from './services/LeaderboardsService.ts';
export type { Item, PlayerItem } from './services/ItemsService.ts';

// Spreadable base columns per dialect for user schema customization
export {
  userColumns as sqliteUserColumns,
  configColumns as sqliteConfigColumns,
  cloudSaveColumns as sqliteCloudSaveColumns,
  leaderboardColumns as sqliteLeaderboardColumns,
  leaderboardEntryColumns as sqliteLeaderboardEntryColumns,
  itemColumns as sqliteItemColumns,
  playerItemColumns as sqlitePlayerItemColumns,
} from './schemas/sqlite.ts';
export {
  userColumns as pgUserColumns,
  configColumns as pgConfigColumns,
  cloudSaveColumns as pgCloudSaveColumns,
  leaderboardColumns as pgLeaderboardColumns,
  leaderboardEntryColumns as pgLeaderboardEntryColumns,
  itemColumns as pgItemColumns,
  playerItemColumns as pgPlayerItemColumns,
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
} from './schemas/sqlite.ts';
import {
  userColumns as pgUsers,
  configColumns as pgConfigs,
  cloudSaveColumns as pgCloudSaves,
  leaderboardColumns as pgLeaderboards,
  leaderboardEntryColumns as pgLeaderboardEntries,
  itemColumns as pgItems,
  playerItemColumns as pgPlayerItems,
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
  },
  pg: {
    users: pgUsers,
    configs: pgConfigs,
    cloudSaves: pgCloudSaves,
    leaderboards: pgLeaderboards,
    leaderboardEntries: pgLeaderboardEntries,
    items: pgItems,
    playerItems: pgPlayerItems,
  },
};
