export { GameDatabase } from './GameDatabase.ts';
export type { GameDatabaseOptions } from './GameDatabase.ts';

export { VersionConflictError } from './services/CloudSaveService.ts';

// Spreadable base columns per dialect for user schema customization
export { userColumns as sqliteUserColumns, configColumns as sqliteConfigColumns, cloudSaveColumns as sqliteCloudSaveColumns } from './schemas/sqlite.ts';
export { userColumns as pgUserColumns, configColumns as pgConfigColumns, cloudSaveColumns as pgCloudSaveColumns } from './schemas/pg.ts';

// Namespaced columns export: columns.sqlite.users, columns.pg.users, etc.
import { userColumns as sqliteUsers, configColumns as sqliteConfigs, cloudSaveColumns as sqliteCloudSaves } from './schemas/sqlite.ts';
import { userColumns as pgUsers, configColumns as pgConfigs, cloudSaveColumns as pgCloudSaves } from './schemas/pg.ts';

export const columns = {
  sqlite: { users: sqliteUsers, configs: sqliteConfigs, cloudSaves: sqliteCloudSaves },
  pg: { users: pgUsers, configs: pgConfigs, cloudSaves: pgCloudSaves },
};
