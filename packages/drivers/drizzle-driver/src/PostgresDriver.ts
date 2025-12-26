import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { pgTable, integer, boolean, timestamp, jsonb, getTableConfig, varchar } from 'drizzle-orm/pg-core';
import { eq, and, sql } from 'drizzle-orm';

import {
  type IRoomCache,
  type MatchMakerDriver,
  type Room,
  type SortOptions,
  debugMatchMaking,
  matchMaker,
} from '@colyseus/core';

import { sanitizeRoomData, generateCreateTableSQL, buildWhereClause, buildOrderBy } from './utils.ts';
import type { ExtractMetadata } from '@colyseus/core/matchmaker/driver/api';

/**
 * Define default `roomcaches` table schema using Drizzle
 * May be overridden by the user by providing a custom schema in the constructor.
 */
export const roomcaches = pgTable('roomcaches_v1', {
  roomId: varchar({ length: 9 }).primaryKey(),
  processId: varchar({ length: 9 }),
  name: varchar({ length: 64 }).notNull(),
  clients: integer().notNull(),
  maxClients: integer().notNull(),
  locked: boolean(),
  private: boolean(),
  metadata: jsonb(),
  publicAddress: varchar({ length: 255 }),
  createdAt: timestamp().notNull().defaultNow(),
  unlisted: boolean(),
});

export type RoomCache = typeof roomcaches.$inferSelect;

export class PostgresDriver implements MatchMakerDriver {
  private sql: ReturnType<typeof postgres>;
  private db: PostgresJsDatabase;
  private schema: typeof roomcaches;

  constructor(options?: {
    db?: PostgresJsDatabase;
    schema?: typeof roomcaches;
  }) {
    // Allow user to provide their own roomcaches schema
    this.schema = options?.schema || roomcaches;

    if (options?.db) {
      this.db = options.db;
      this.sql = null as any; // User is managing their own connection

    } else {
      this.sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres');
      this.db = drizzle(this.sql);
      // this.db = drizzle(this.sql, { logger: true });
    }
  }

  public async boot() {
    if (!this.sql) {
      throw new Error('PostgresDriver: Cannot call boot() when using external database instance. Please manage schema initialization externally.');
    }

    const tableConfig = getTableConfig(this.schema);
    const tableName = tableConfig.name;

    // Create table if it doesn't exist
    try {
      // Check if table exists
      const tableExists = await this.sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = ${tableName}
        )
      `;

      const exists = tableExists[0]?.exists;

      if (!exists) {
        await this.sql.unsafe(generateCreateTableSQL(tableConfig));
        debugMatchMaking(`DrizzleDriver: created ${tableName} table`);
      }

    } catch (error) {
      debugMatchMaking(`DrizzleDriver: error creating ${tableName} table:`, error);
      throw error;
    }
  }

  public async has(roomId: string) {
    const result = await this.db
      .select()
      .from(this.schema)
      .where(eq(this.schema.roomId, roomId))
      .limit(1);
    return result.length > 0;
  }

  public async query<T extends Room = any>(
    conditions: Partial<IRoomCache & ExtractMetadata<T>>,
    sortOptions?: SortOptions
  ): Promise<Array<IRoomCache<ExtractMetadata<T>>>> {
    return await this.getRooms<T>(conditions, sortOptions);
  }

  public async cleanup(processId: string) {
    const { count } = await this.db
      .delete(this.schema)
      .where(eq(this.schema.processId, processId))
      .execute();
    debugMatchMaking(`DrizzleDriver: removing stale rooms by processId ${processId} (${count} rooms found)`);
  }

  public async findOne<T extends Room = any>(
    conditions: Partial<IRoomCache & ExtractMetadata<T>>,
    sortOptions?: SortOptions
  ) {
    if (typeof conditions.roomId !== 'undefined') {
      return (await this.db
        .select()
        .from(this.schema)
        .where(eq(this.schema.roomId, conditions.roomId))
        .limit(1))[0] as IRoomCache<ExtractMetadata<T>>;

    } else {
      // filter list by other conditions
      return (await this.getRooms<T>(conditions, sortOptions, 1))[0];
    }
  }

  private getRooms<T extends Room = any>(
    conditions: Partial<IRoomCache & ExtractMetadata<T>>,
    sortOptions?: SortOptions,
    limit?: number
  ): Promise<Array<IRoomCache<ExtractMetadata<T>>>> {
    const registeredHandler = matchMaker.getAllHandlers()[conditions.name];

    let query = this.db
      .select()
      .from(this.schema)
      .where(and(...buildWhereClause(registeredHandler, this.schema, conditions)))
      .$dynamic();

    // Apply order by if provided
    const orderBy = buildOrderBy(registeredHandler, this.schema, sortOptions);
    if (orderBy.length > 0) { query = query.orderBy(...orderBy); }

    // Apply limit if provided
    if (limit !== undefined) { query = query.limit(limit); }

    return query.then((result) => result.map((room) => room as IRoomCache<ExtractMetadata<T>>));
  }

  public async update(room: IRoomCache, operations: Partial<{ $set: Partial<IRoomCache>, $inc: Partial<IRoomCache> }>) {
    const setFields: any = {};

    if (operations.$set) {
      for (const field in operations.$set) {
        if (operations.$set.hasOwnProperty(field) && operations.$set[field] !== undefined) {
          setFields[field] = operations.$set[field];
        }
      }
    }

    if (operations.$inc) {
      for (const field in operations.$inc) {
        if (operations.$inc.hasOwnProperty(field)) {
          const value = operations.$inc[field];
          if (value !== undefined) {
            setFields[field] = (value >= 0)
              ? sql`${this.schema[field]} + ${value}::integer`
              : sql`${this.schema[field]} - ${Math.abs(value)}::integer`;
          }
        }
      }
    }

    // Skip update if there are no fields to update
    if (Object.keys(setFields).length === 0) {
      return true;
    }

    await this.db
      .update(this.schema)
      .set(setFields)
      .where(eq(this.schema.roomId, room.roomId))
      .execute();

    return true;
  }

  public async persist(room: IRoomCache, create: boolean = false) {
    if (create) {
      // Create new record
      const insertFields: any = sanitizeRoomData(this.schema, room);
      await this.db.insert(this.schema).values(insertFields);

    } else {
      // Update existing record
      const updateFields: any = sanitizeRoomData(this.schema, room);
      delete updateFields.roomId; // Don't update the primary key
      await this.update(room, { $set: updateFields });
    }

    return true;
  }

  public async remove(roomId: string) {
    const { count } = await this.db
      .delete(this.schema)
      .where(eq(this.schema.roomId, roomId))
      .execute();
    return count > 0;
  }

  public async shutdown() {
    // Only close the connection if we created it ourselves
    if (this.sql) {
      await this.sql.end();
      this.sql = undefined;
    }
  }

  public async clear() {
    // skip if already shut down.
    if (!this.sql) { return; }

    const tableConfig = getTableConfig(this.schema);
    const tableName = tableConfig.name;

    // Drop the table completely to ensure schema is fresh
    await this.sql.unsafe(`DROP TABLE IF EXISTS ${tableName} CASCADE`);

    // Recreate the table using schema definition
    await this.sql.unsafe(generateCreateTableSQL(tableConfig));
  }

}
