#!/usr/bin/env tsx
/**
 * Generate a single consolidated drizzle-compatible migration from a schema
 * module. Replaces `drizzle-kit generate` for the cases where it's broken
 * on the 1.0.0-rc.* line (drizzle-kit / drizzle-orm version cross-checks
 * fail even with matching versions).
 *
 * Usage:
 *   tsx scripts/regen-migration.ts \
 *     --dialect sqlite \
 *     --schema ./test/fixtures/custom-schema/schema.ts \
 *     --out    ./test/fixtures/custom-schema/migrations
 *
 * Behavior:
 *   - Walks every drizzle Table export in the schema module.
 *   - Calls dialect-appropriate `getTableConfig` + the package's
 *     `generateCreateTableSQL` (the same DDL generator GameDatabase.boot
 *     uses for `migrations: 'auto'` — single source of truth, so file-
 *     based and auto-strategy stay in sync).
 *   - WIPES every existing `<timestamp>_*` directory in `out/` and writes
 *     a fresh `<YYYYMMDDHHmmss>_initial/migration.sql` joined with
 *     `--> statement-breakpoint`. drizzle 1.0's migrator just walks the
 *     directory sorted by name; no journal needed.
 *
 * If you need ALTER-style incremental migrations (e.g. adding columns to
 * an already-deployed schema), keep this script for the initial baseline
 * and append further `<timestamp>_<name>/migration.sql` directories by
 * hand — the migrator picks them up in name order.
 */
import fs from 'node:fs';
import path from 'node:path';
import { generateCreateTableSQL } from '../src/utils.ts';

interface Args {
  dialect: 'sqlite' | 'pg';
  schema: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const args = { dialect: '', schema: '', out: '' } as any;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--dialect') { args.dialect = next; i++; }
    else if (a === '--schema') { args.schema = next; i++; }
    else if (a === '--out') { args.out = next; i++; }
  }
  if (!['sqlite', 'pg'].includes(args.dialect)) {
    throw new Error(`--dialect must be 'sqlite' or 'pg' (got ${JSON.stringify(args.dialect)})`);
  }
  if (!args.schema) { throw new Error('--schema <path> is required'); }
  if (!args.out) { throw new Error('--out <dir> is required'); }
  return args;
}

function timestamp(): string {
  // Drizzle 1.0's migrator parses the leading 14 chars of the dir name as
  // YYYYMMDDHHmmss; using the same shape keeps name-sorted ordering stable.
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    d.getUTCFullYear(),
    pad(d.getUTCMonth() + 1),
    pad(d.getUTCDate()),
    pad(d.getUTCHours()),
    pad(d.getUTCMinutes()),
    pad(d.getUTCSeconds()),
  ].join('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const cwd = process.cwd();
  const schemaAbs = path.resolve(cwd, args.schema);
  const outAbs = path.resolve(cwd, args.out);

  const getTableConfig: (table: any) => any = args.dialect === 'pg'
    ? (await import('drizzle-orm/pg-core')).getTableConfig
    : (await import('drizzle-orm/sqlite-core')).getTableConfig;

  // Load schema. The path can be a relative ts file; node's loader
  // resolves it via the project's tsx setup.
  const schemaUrl = new URL(`file://${schemaAbs}`);
  const mod = await import(schemaUrl.href);

  // Pick out every drizzle Table export. Drizzle stamps a known symbol on
  // each table; presence of `Symbol.for('drizzle:Name')` is a reliable test
  // that survives both pg-core and sqlite-core.
  const tableNameSymbol = Symbol.for('drizzle:Name');
  const tables: Array<{ key: string; table: any }> = [];
  for (const [k, v] of Object.entries(mod)) {
    if (v && typeof v === 'object' && (v as any)[tableNameSymbol]) {
      tables.push({ key: k, table: v });
    }
  }
  if (tables.length === 0) {
    throw new Error(`no drizzle tables exported from ${args.schema}`);
  }

  // Generate one CREATE TABLE per table; statements separated by
  // `--> statement-breakpoint` so drizzle's migrator splits them.
  const statements = tables.map(({ table }) => {
    const cfg = getTableConfig(table);
    return generateCreateTableSQL(cfg);
  });
  const sql = statements.join(';\n--> statement-breakpoint\n') + ';\n';

  // Wipe existing <timestamp>_* directories so the fresh migration is the
  // only one. (Hand-rolled migration dirs that don't match the timestamp
  // prefix pattern are left alone, in case they're being preserved
  // intentionally.)
  fs.mkdirSync(outAbs, { recursive: true });
  for (const entry of fs.readdirSync(outAbs)) {
    const full = path.join(outAbs, entry);
    if (fs.statSync(full).isDirectory() && /^\d{14}_/.test(entry)) {
      fs.rmSync(full, { recursive: true, force: true });
    }
  }

  const ts = timestamp();
  const dirName = `${ts}_initial`;
  const dir = path.join(outAbs, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'migration.sql'), sql);

  // Console output is the source of truth for the user — keep it short
  // but tell them where the file landed and how many tables made it in.
  // eslint-disable-next-line no-console
  console.log(
    `[regen-migration] wrote ${tables.length} CREATE TABLE statement(s) to\n` +
    `  ${path.relative(cwd, path.join(dir, 'migration.sql'))}`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[regen-migration]', err?.message ?? err);
  process.exit(1);
});
