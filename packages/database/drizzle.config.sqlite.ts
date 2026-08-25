/**
 * drizzle-kit config for generating SQLite migrations.
 *
 * Run from this package:
 *   pnpm exec drizzle-kit generate --config=drizzle.config.sqlite.ts
 *
 * Output goes to ./drizzle/sqlite/ — commit those files, then in your app:
 *   new GameDatabase({
 *     connectionString: 'colyseus.db',
 *     migrations: { files: './node_modules/@colyseus/database/drizzle/sqlite' },
 *   })
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schemas/sqlite.ts',
  out: './drizzle/sqlite',
  dbCredentials: {
    url: process.env.SQLITE_DB ?? 'colyseus.db',
  },
});
