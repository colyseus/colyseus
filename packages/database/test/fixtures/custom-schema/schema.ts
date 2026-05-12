/**
 * Test fixture: a user-style schema barrel that customizes `users` and
 * re-exports the rest from the package defaults. Mirrors the pattern
 * documented on @colyseus/database/sqlite-defaults.
 *
 * Used by migrations-custom.test.ts and as the source for the committed
 * migration files in ./migrations/.
 */
import { tables } from '../../../src/index.ts';
import { integer, text } from 'drizzle-orm/sqlite-core';

export const users = tables.sqlite.users('users', {
  displayName: text('display_name'),
  level: integer('level').default(1),
});

export {
  configs,
  cloudSaves,
  leaderboards,
  leaderboardEntries,
  analyticsEvents,
  roles,
  userNotes,
  adminAudit,
} from '../../../src/sqlite-defaults.ts';
