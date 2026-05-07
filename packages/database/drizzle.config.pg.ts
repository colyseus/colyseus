/**
 * drizzle-kit config for generating PostgreSQL migrations.
 *
 * Run from this package:
 *   pnpm exec drizzle-kit generate --config=drizzle.config.pg.ts
 *
 * Output goes to ./drizzle/pg/ — commit those files, then in your app:
 *   new GameDatabase({
 *     connectionString: 'postgres://...',
 *     migrations: { files: './node_modules/@colyseus/database/drizzle/pg' },
 *   })
 *
 * (Or copy the SQL files into your own repo; drizzle-kit's diff output is
 * stable across machines.)
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schemas/pg.ts',
  out: './drizzle/pg',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres',
  },
});
