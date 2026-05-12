/**
 * Application schema — single source of truth for both GameDatabase (runtime)
 * and drizzle-kit (migration generation). The pattern:
 *
 *   - Customize tables you want to extend (here: `users` gets two extra
 *     columns).
 *   - Re-export the rest from `@colyseus/database/sqlite-defaults` so
 *     drizzle-kit sees them as exports of this file.
 *
 * Wire this in:
 *
 *   // app.config.ts
 *   import * as schema from './db/schema.ts';
 *   new GameDatabase({ schemas: schema, migrations: { files: './drizzle' } });
 *
 *   // drizzle.config.ts
 *   export default defineConfig({
 *     dialect: 'sqlite',
 *     schema: './src/db/schema.ts',
 *     out: './drizzle',
 *     dbCredentials: { url: 'colyseus.db' },
 *   });
 */
import { tables } from "@colyseus/database";
import { integer, text } from "drizzle-orm/sqlite-core";

export const users = tables.sqlite.users("users", {
  displayName: text("display_name"),
  level: integer("level").default(1),
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
} from "@colyseus/database/sqlite-defaults";
