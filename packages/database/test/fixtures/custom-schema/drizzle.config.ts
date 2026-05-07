/**
 * drizzle-kit config for the custom-schema fixture. Used to (re)generate
 * the SQL files under ./migrations from inside the database package:
 *
 *   pnpm exec drizzle-kit generate \
 *     --config=test/fixtures/custom-schema/drizzle.config.ts
 *
 * The committed migration output is what migrations-custom.test.ts
 * actually applies.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './test/fixtures/custom-schema/schema.ts',
  out: './test/fixtures/custom-schema/migrations',
});
