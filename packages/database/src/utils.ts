/**
 * Adapted from packages/drivers/drizzle-driver/src/utils.ts
 * Enhanced with composite primary key and foreign key support.
 *
 * Works with both SQLite and PG table configs (both expose the same
 * structural shape from getTableConfig).
 */

export function generateCreateTableSQL(config: {
  name: string;
  columns: Array<{
    name: string;
    getSQLType(): string;
    primary: boolean;
    notNull: boolean;
    default?: any;
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
}): string {
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
 * Generate ALTER TABLE … ADD COLUMN statements for columns that exist in the
 * drizzle table config but not in `existingColumnNames`. Returns one statement
 * per missing column. Empty array if everything is up to date.
 *
 * Drop and type-change are intentionally not handled — they're risky, and
 * dev workflows can blow away the file/PGlite to force a recreate.
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
