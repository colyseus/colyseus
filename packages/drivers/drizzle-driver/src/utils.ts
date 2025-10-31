import type { IRoomCache, SortOptions } from "@colyseus/core";
import { getTableConfig, type PgTableWithColumns } from 'drizzle-orm/pg-core';
import { eq, asc, desc, type SQL } from 'drizzle-orm';

const POSTGRES_MAX_INTEGER = 2147483647;  // Max integer value in PostgreSQL

// Helper function to sanitize room data before persisting
export function sanitizeRoomData(room: Partial<IRoomCache>): IRoomCache {
  const sanitized: any = { ...room };

  // Convert "Infinity" to a large number
  if (sanitized.maxClients > POSTGRES_MAX_INTEGER) {
    sanitized.maxClients = POSTGRES_MAX_INTEGER;
  }

  return sanitized;
}

// Build WHERE clause conditions for Drizzle ORM
export function buildWhereClause(schema: PgTableWithColumns<any>, conditions: Partial<IRoomCache>): SQL[] {
  return Object.entries(conditions).map(([fieldName, value]) => eq(schema[fieldName], value));
}

// Build ORDER BY clauses for Drizzle ORM
export function buildOrderBy(schema: PgTableWithColumns<any>, sortOptions?: SortOptions): SQL[] {
  return Object.entries(sortOptions ?? {}).map(([fieldName, direction]) => {
    const isDescending = (direction === -1 || direction === 'desc' || direction === 'descending');
    return isDescending ? desc(schema[fieldName]) : asc(schema[fieldName]);
  });
}

// Generate CREATE TABLE SQL string from Drizzle schema
export function generateCreateTableSQL(config: ReturnType<typeof getTableConfig>): string {
  const tableName = config.name;

  const columnDefinitions = config.columns.map(col => {
    let def = `"${col.name}" ${col.getSQLType()}`;

    if (col.primary) {
      def += ' PRIMARY KEY';
    }

    if (col.notNull) {
      def += ' NOT NULL';
    }

    if (col.default !== undefined) {
      def += ` DEFAULT ${col.default}`;
    }

    return def;
  }).join(',\n          ');

  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
          ${columnDefinitions}
        )
  `;
}