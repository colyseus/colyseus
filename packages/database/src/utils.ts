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

// Extract SQL string from Drizzle SQL objects
function extractSQLString(sqlObj: any): string {
  if (!sqlObj || !sqlObj.queryChunks) {
    return String(sqlObj);
  }

  return sqlObj.queryChunks
    .map((chunk: any) => {
      if (chunk.value && Array.isArray(chunk.value)) {
        return chunk.value.join('');
      }
      return '';
    })
    .join('');
}
