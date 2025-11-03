import type { IRoomCache, SortOptions, RegisteredHandler } from "@colyseus/core";
import { getTableConfig, type PgTableWithColumns } from 'drizzle-orm/pg-core';
import { eq, asc, desc, sql, type SQL } from 'drizzle-orm';

const POSTGRES_MAX_INTEGER = 2147483647;  // Max integer value in PostgreSQL

// Helper function to sanitize room data before persisting
export function sanitizeRoomData(schema: PgTableWithColumns<any>, room: Partial<IRoomCache>): IRoomCache {
  const sanitized: any = {};
  const metadata: Record<string, any> = {};

  // Filter out undefined values and sanitize the data
  // Separate schema columns from custom filter fields
  for (const fieldName in room) {
    if (room.hasOwnProperty(fieldName)) {
      const value = room[fieldName];
      if (value !== undefined) {
        if (schema[fieldName] !== undefined) {
          sanitized[fieldName] = value;
        } else {
          // Custom fields go into metadata
          metadata[fieldName] = value;
        }
      }
      // Note: We don't set undefined values to null because we want to omit them entirely
      // so the database can use its default values
    }
  }

  // Merge custom fields into metadata
  if (Object.keys(metadata).length > 0) {
    sanitized.metadata = {
      ...(sanitized.metadata || {}),
      ...metadata
    };
  }

  // Convert "Infinity" to a large number
  if (sanitized.maxClients > POSTGRES_MAX_INTEGER) {
    sanitized.maxClients = POSTGRES_MAX_INTEGER;
  }

  return sanitized;
}

// Build WHERE clause conditions for Drizzle ORM
export function buildWhereClause(
  registeredHandler: RegisteredHandler | undefined,
  schema: PgTableWithColumns<any>,
  conditions: Partial<IRoomCache>
): SQL[] {
  return Object.entries(conditions)
    .filter(([_, value]) => value !== undefined)
    .map(([fieldName, value]) => {
      // Check if this field exists in the schema first - schema fields take priority
      const isMetadataField = (
        schema[fieldName] === undefined &&
        registeredHandler?.filterOptions?.includes(fieldName as any)
      );

      if (isMetadataField) {
        // Use JSONB query for metadata fields: metadata->>'fieldName' = value
        return sql`${schema.metadata}->>${fieldName} = ${value}`;
      } else {
        // Use standard schema field
        return eq(schema[fieldName], value);
      }
    });
}

// Build ORDER BY clauses for Drizzle ORM
export function buildOrderBy(
  registeredHandler: RegisteredHandler | undefined,
  schema: PgTableWithColumns<any>,
  sortOptions?: SortOptions
): SQL[] {
  return Object.entries(sortOptions ?? {}).map(([fieldName, direction]) => {
    const isDescending = (direction === -1 || direction === 'desc' || direction === 'descending');

    // Check if this field exists in the schema first - schema fields take priority
    const isMetadataField = (
      schema[fieldName] === undefined &&
      registeredHandler?.sortOptions &&
      fieldName in registeredHandler.sortOptions
    );

    if (isMetadataField) {
      // Use JSONB query for metadata fields: metadata->>'fieldName'
      const metadataField = sql`${schema.metadata}->>${fieldName}`;
      return isDescending ? desc(metadataField) : asc(metadataField);
    } else {
      // Use standard schema field
      return isDescending ? desc(schema[fieldName]) : asc(schema[fieldName]);
    }
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
      def += ` DEFAULT ${extractSQLString(col.default)}`;
    }

    return def;
  }).join(',\n          ');

  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
          ${columnDefinitions}
        )
  `;
}

// Helper function to extract SQL string from Drizzle SQL objects
function extractSQLString(sqlObj: any): string {
  if (!sqlObj || !sqlObj.queryChunks) {
    return String(sqlObj);
  }

  // Extract SQL string from queryChunks
  return sqlObj.queryChunks
    .map((chunk: any) => {
      if (chunk.value && Array.isArray(chunk.value)) {
        return chunk.value.join('');
      }
      return '';
    })
    .join('');
}