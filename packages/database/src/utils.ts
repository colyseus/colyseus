/**
 * Adapted from packages/drivers/drizzle-driver/src/utils.ts
 * Enhanced with composite primary key and foreign key support.
 *
 * Works with both SQLite and PG table configs (both expose the same
 * structural shape from getTableConfig).
 */
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { PgDialect } from 'drizzle-orm/pg-core';

export type DdlDialect = 'sqlite' | 'pg';

/**
 * Structural subset of drizzle's `getTableConfig()` result that the DDL
 * generators read. Shared by sqlite-core and pg-core.
 */
export interface TableDdlConfig {
  name: string;
  columns: Array<{
    name: string;
    getSQLType(): string;
    primary: boolean;
    notNull: boolean;
    default?: any;
    isUnique?: boolean;
    uniqueName?: string;
    uniqueType?: string;
  }>;
  primaryKeys?: Array<{
    columns: Array<{ name: string }>;
  }>;
  foreignKeys?: Array<{
    reference: () => {
      columns: Array<{ name: string }>;
      foreignColumns: Array<{ name: string; table?: any }>;
    };
  }>;
  uniqueConstraints?: Array<{
    columns: Array<{ name: string }>;
    nullsNotDistinct?: boolean;
    getName(): string | undefined;
  }>;
  checks?: Array<{ name: string; value: any }>;
  indexes?: Array<{
    config: {
      name?: string;
      columns: any[];
      unique: boolean;
      where?: any;
      method?: string;
    };
  }>;
}

const dialects = {
  sqlite: new SQLiteSyncDialect(),
  pg: new PgDialect(),
};

/**
 * Render a drizzle `SQL` fragment the way drizzle-kit does for constraints and
 * indexes: params inlined, column references unqualified (`"handle"` rather
 * than `"users"."handle"`), so the text is valid inside CREATE TABLE.
 */
function renderSql(fragment: any, dialect: DdlDialect): string {
  return dialects[dialect].sqlToQuery(fragment.inlineParams(), 'indexes').sql;
}

function isSqlFragment(value: any): boolean {
  return value && Array.isArray(value.queryChunks);
}

/**
 * CREATE TABLE IF NOT EXISTS for one table: columns, single or composite
 * primary key, foreign keys, column-level and table-level UNIQUE, and CHECK
 * constraints. Indexes are separate statements, see `generateCreateIndexSQL`.
 */
export function generateCreateTableSQL(config: TableDdlConfig, dialect: DdlDialect = 'sqlite'): string {
  const tableName = config.name;
  const hasCompositePK = config.primaryKeys && config.primaryKeys.length > 0;

  const columnDefinitions = config.columns.map(col => {
    let def = `"${col.name}" ${col.getSQLType()}`;

    // Only add PRIMARY KEY on individual columns if there's no composite PK
    if (col.primary && !hasCompositePK) {
      def += ' PRIMARY KEY';
    }

    if (col.notNull) {
      def += ' NOT NULL';
    }

    if (col.isUnique) {
      def += ' UNIQUE';
      if (dialect === 'pg' && col.uniqueType === 'not distinct') {
        def += ' NULLS NOT DISTINCT';
      }
    }

    if (col.default !== undefined) {
      def += ` DEFAULT ${extractSQLString(col.default)}`;
    }

    return def;
  });

  // Add composite primary key constraint
  if (hasCompositePK) {
    for (const pk of config.primaryKeys) {
      const colNames = pk.columns.map(c => `"${c.name}"`).join(', ');
      columnDefinitions.push(`PRIMARY KEY (${colNames})`);
    }
  }

  for (const uq of config.uniqueConstraints ?? []) {
    const colNames = uq.columns.map(c => `"${c.name}"`).join(', ');
    const name = uq.getName();
    let def = name ? `CONSTRAINT "${name}" UNIQUE` : 'UNIQUE';
    if (dialect === 'pg' && uq.nullsNotDistinct) {
      def += ' NULLS NOT DISTINCT';
    }
    columnDefinitions.push(`${def} (${colNames})`);
  }

  for (const check of config.checks ?? []) {
    columnDefinitions.push(`CONSTRAINT "${check.name}" CHECK (${renderSql(check.value, dialect)})`);
  }

  // Add foreign key constraints
  if (config.foreignKeys && config.foreignKeys.length > 0) {
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      const localCols = ref.columns.map(c => `"${c.name}"`).join(', ');
      const foreignCols = ref.foreignColumns.map(c => `"${c.name}"`).join(', ');

      // Extract foreign table name from Drizzle's internal structure
      const foreignCol = ref.foreignColumns[0] as any;
      const drizzleNameSymbol = Symbol.for("drizzle:Name");
      const foreignTableName = foreignCol?.table?.[drizzleNameSymbol]
        || foreignCol?.table?._?.name
        || 'unknown';

      columnDefinitions.push(`FOREIGN KEY (${localCols}) REFERENCES "${foreignTableName}" (${foreignCols})`);
    }
  }

  return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${columnDefinitions.join(',\n  ')}\n)`;
}

/**
 * One `CREATE [UNIQUE] INDEX IF NOT EXISTS` per index declared in the table's
 * extra config (`index()` / `uniqueIndex()`, with optional `.where()`).
 * Idempotent, so the auto strategy can run them on every boot and tables
 * created before an index was declared still receive it.
 */
export function generateCreateIndexSQL(config: TableDdlConfig, dialect: DdlDialect = 'sqlite'): string[] {
  const out: string[] = [];
  for (const index of config.indexes ?? []) {
    const cfg = index.config;
    const columns = cfg.columns.map((col: any) => {
      if (isSqlFragment(col)) { return `(${renderSql(col, dialect)})`; }
      let def = `"${col.name}"`;
      // pg: `.asc()` / `.desc()` / `.nullsFirst()` / `.nullsLast()`; drizzle
      // pre-fills `indexConfig` with the defaults, so only emit what differs.
      const ic = col.indexConfig;
      const defaults = col.defaultConfig ?? {};
      if (ic?.order && ic.order !== defaults.order) { def += ` ${String(ic.order).toUpperCase()}`; }
      if (ic?.nulls && ic.nulls !== defaults.nulls) { def += ` NULLS ${String(ic.nulls).toUpperCase()}`; }
      return def;
    });
    const name = cfg.name
      ?? `${config.name}_${cfg.columns.map((c: any) => c.name ?? 'expr').join('_')}_index`;
    let stmt = `CREATE ${cfg.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS "${name}" ON "${config.name}"`;
    if (dialect === 'pg' && cfg.method && cfg.method !== 'btree') {
      stmt += ` USING ${cfg.method}`;
    }
    stmt += ` (${columns.join(', ')})`;
    if (cfg.where) {
      stmt += ` WHERE ${renderSql(cfg.where, dialect)}`;
    }
    out.push(stmt);
  }
  return out;
}

/**
 * Generate ALTER TABLE … ADD COLUMN statements for columns that exist in the
 * drizzle table config but not in `existingColumnNames`. Returns one statement
 * per missing column. Empty array if everything is up to date.
 *
 * Drop, type-change and constraints on an existing table are intentionally not
 * handled — they're risky, and dev workflows can blow away the file/PGlite to
 * force a recreate. Declare `uniqueIndex()` instead of `.unique()` when the
 * table may already exist: indexes are applied on every boot.
 */
export function generateAlterAddColumnSQL(
  config: {
    name: string;
    columns: Array<{
      name: string;
      getSQLType(): string;
      primary: boolean;
      notNull: boolean;
      default?: any;
    }>;
  },
  existingColumnNames: Set<string>,
): string[] {
  const result: string[] = [];
  for (const col of config.columns) {
    if (existingColumnNames.has(col.name)) { continue; }

    let columnDef = `"${col.name}" ${col.getSQLType()}`;
    // ADD COLUMN cannot specify PRIMARY KEY directly in either dialect; that's set up at CREATE.
    if (col.notNull && col.default === undefined) {
      // SQLite + PG both reject NOT NULL ADD COLUMN without a default on a non-empty table.
      // Skip the constraint here — caller still gets the column; the operator can tighten later.
    } else if (col.notNull) {
      columnDef += ' NOT NULL';
    }
    if (col.default !== undefined) {
      columnDef += ` DEFAULT ${extractSQLString(col.default)}`;
    }
    result.push(`ALTER TABLE "${config.name}" ADD COLUMN ${columnDef}`);
  }
  return result;
}

/**
 * Format a column default for inclusion in CREATE TABLE.
 *
 * Drizzle stores defaults as one of:
 *   - a JS primitive (string, number, boolean) — `default('misc')`, `default(1)`, `default(true)`
 *   - a Date — `default(new Date('2020-01-01'))`
 *   - a SQL object with queryChunks — `default(sql\`now()\`)`, `defaultNow()`
 *
 * Bare String() coercion was emitting `DEFAULT misc` (unquoted) for string
 * defaults, which Postgres rejects as "cannot use column reference in DEFAULT
 * expression". SQLite accepted it loosely. Each value type now formats
 * dialect-portably.
 */
function extractSQLString(value: any): string {
  if (value === null || value === undefined) { return 'NULL'; }
  if (typeof value === 'string') { return `'${value.replace(/'/g, "''")}'`; }
  if (typeof value === 'number' || typeof value === 'boolean') { return String(value); }
  if (value instanceof Date) { return `'${value.toISOString()}'`; }
  if (value && Array.isArray(value.queryChunks)) {
    return value.queryChunks
      .map((chunk: any) => {
        if (typeof chunk === 'string') { return chunk; }
        if (chunk?.value !== undefined) {
          if (Array.isArray(chunk.value)) { return chunk.value.join(''); }
          if (typeof chunk.value === 'string') { return chunk.value; }
        }
        return '';
      })
      .join('');
  }
  // Fallback — unknown shape; coerce, single-quote if it produced text content.
  const s = String(value);
  return /^[A-Za-z_]/.test(s) ? `'${s.replace(/'/g, "''")}'` : s;
}
