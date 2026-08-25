/**
 * Heuristic mapping from table-name keywords to icon names.
 *
 * Intent: a fresh Colyseus admin should look meaningful out of the box,
 * without users having to set `icon` on every resource. Users can always
 * override via `defineAdminResource(table, { icon: 'rocket' })`.
 *
 * Names come from the canonical `AdminIconName` union in `./icons.ts`;
 * the client (`src/icons.tsx`) maps each to a lucide-react component.
 *
 * Compound names (e.g. analytics_events, cloud_saves) MUST come before
 * generic suffix rules (events, saves) — first match wins.
 */
import type { AdminIconName } from './icons.js';

const RULES: Array<[RegExp, AdminIconName]> = [
  // moderation/RBAC
  [/(^|_)mod_assignments?$/, 'safety'],
  [/(^|_)moderation$/, 'safety'],
  [/(^|_)permissions?$/, 'key'],
  [/(^|_)tokens?$/, 'key'],
  [/(^|_)keys?$/, 'key'],
  [/(^|_)roles?$/, 'safety'],
  [/(^|_)bans?$/, 'stop'],
  [/(^|_)reports?$/, 'warning'],

  // identity / social
  [/(^|_)users?$/, 'user'],
  [/(^|_)players?$/, 'user'],
  [/(^|_)characters?$/, 'user'],
  [/(^|_)friends?$/, 'user-add'],
  [/(^|_)avatars?$/, 'smile'],
  [/(^|_)guilds?$/, 'team'],
  [/(^|_)teams?$/, 'team'],
  [/(^|_)groups?$/, 'team'],
  [/(^|_)clans?$/, 'team'],
  [/(^|_)parties?$/, 'team'],

  // economy / inventory
  [/(^|_)player_items?$/, 'appstore'],
  [/(^|_)inventory$/, 'appstore'],
  [/(^|_)items?$/, 'shopping'],
  [/(^|_)products?$/, 'shopping'],
  [/(^|_)orders?$/, 'shopping-cart'],
  [/(^|_)payments?$/, 'credit-card'],
  [/(^|_)transactions?$/, 'credit-card'],
  [/(^|_)purchases?$/, 'credit-card'],
  [/(^|_)rewards?$/, 'gift'],

  // leaderboards / progression
  [/(^|_)leaderboard_entries$/, 'trophy'],
  [/(^|_)leaderboards?$/, 'trophy'],
  [/(^|_)scores?$/, 'trophy'],
  [/(^|_)achievements?$/, 'trophy'],
  [/(^|_)rankings?$/, 'trophy'],
  [/(^|_)tournaments?$/, 'trophy'],
  [/(^|_)quests?$/, 'flag'],
  [/(^|_)missions?$/, 'flag'],
  [/(^|_)levels?$/, 'node-index'],

  // saves / configs / events — compound names first
  [/(^|_)cloud_saves?$/, 'cloud'],
  [/(^|_)timed_events?$/, 'clock-circle'],
  [/(^|_)analytics_events?$/, 'line-chart'],

  [/(^|_)saves?$/, 'save'],
  [/(^|_)configs?$/, 'setting'],
  [/(^|_)settings?$/, 'setting'],
  [/(^|_)preferences?$/, 'setting'],
  [/(^|_)events?$/, 'calendar'],
  [/(^|_)schedules?$/, 'calendar'],
  [/(^|_)sessions?$/, 'clock-circle'],

  // analytics / logs
  [/(^|_)analytics?$/, 'line-chart'],
  [/(^|_)metrics?$/, 'line-chart'],
  [/(^|_)stats?$/, 'bar-chart'],
  [/(^|_)logs?$/, 'file-text'],

  // communication
  [/(^|_)messages?$/, 'message'],
  [/(^|_)chats?$/, 'message'],
  [/(^|_)notifications?$/, 'bell'],

  // game world
  [/(^|_)maps?$/, 'environment'],
  [/(^|_)rooms?$/, 'build'],
  [/(^|_)matches?$/, 'thunderbolt'],
  [/(^|_)skins?$/, 'skin'],
];

export function iconForTableName(tableName: string): AdminIconName {
  const lower = tableName.toLowerCase();
  // Strip the framework's `colyseus_` prefix so built-in tables get the right icon.
  const stripped = lower.replace(/^colyseus_/, '');
  for (const [pattern, icon] of RULES) {
    if (pattern.test(stripped)) { return icon; }
  }
  return 'database';
}
