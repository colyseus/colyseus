import type { IRoomCache } from "@colyseus/core";
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';

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