/**
 * Room plugins for @colyseus/database. Importable individually:
 *
 *   import {
 *     AnalyticsPlugin,
 *     CloudSavesPlugin,
 *     LeaderboardsPlugin,
 *   } from '@colyseus/database/plugins';
 *
 * Each plugin is a class extending `@colyseus/core`'s `RoomPlugin`.
 * See `RoomPlugin` + `definePlugins` for the wiring contract.
 */
export {
  AnalyticsPlugin,
  type AnalyticsPluginOptions,
  type AnalyticsLifecycleEvent,
} from './analytics.ts';
export {
  CloudSavesPlugin,
  type CloudSavesPluginOptions,
} from './cloud-saves.ts';
export {
  LeaderboardsPlugin,
  type LeaderboardsPluginOptions,
} from './leaderboards.ts';
export type { UserIdResolver } from './_shared.ts';
