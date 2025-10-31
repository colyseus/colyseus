import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { pgTable, text, integer, boolean, timestamp, jsonb, getTableConfig } from 'drizzle-orm/pg-core';
import { eq, and, asc, desc, sql } from 'drizzle-orm';

import {
  type IRoomCache,
  type MatchMakerDriver,
  type SortOptions,
  debugMatchMaking,
  initializeRoomCache,
  isDevMode,
} from '@colyseus/core';

import { sanitizeRoomData, generateCreateTableSQL, buildWhereClause, buildOrderBy } from './utils.ts';

// Define the roomcaches table schema using Drizzle
export const roomcaches = pgTable('roomcaches_v1', {
  roomId: text().primaryKey(),
  clients: integer().notNull(),
  locked: boolean(),
  private: boolean(),
  maxClients: integer().notNull(),
  metadata: jsonb(),
  name: text(), // Nullable to support partial initialization
  publicAddress: text(),
  processId: text(), // Nullable to support partial initialization
  createdAt: timestamp(),
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
      this.db = drizzle(this.sql, { logger: isDevMode });
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

  public async query(conditions: Partial<IRoomCache>, sortOptions?: SortOptions) {
    return await this.getRooms(conditions, sortOptions);
  }

  public async cleanup(processId: string) {
    const result = await this.db
      .delete(this.schema)
      .where(eq(this.schema.processId, processId))
      .execute();
    debugMatchMaking(`DrizzleDriver: removing stale rooms by processId ${processId} (${result.count} rooms found)`);
  }

  public async findOne(conditions: Partial<IRoomCache>, sortOptions?: SortOptions): Promise<IRoomCache> {
    if (typeof conditions.roomId !== 'undefined') {
      return (await this.db
        .select()
        .from(this.schema)
        .where(eq(this.schema.roomId, conditions.roomId))
        .limit(1))[0] as IRoomCache;

    } else {
      // filter list by other conditions
      return (await this.getRooms(conditions, sortOptions, 1))[0] as IRoomCache;
    }
  }

  private _concurrentQueries: { [key: string]: Promise<IRoomCache[]> } = {};
  private getRooms(conditions: Partial<IRoomCache>, sortOptions?: SortOptions, limit?: number) {
    const key = JSON.stringify({ c: conditions, s: sortOptions });

    // if there's a shared request, return it
    if (this._concurrentQueries[key] !== undefined) {
      return this._concurrentQueries[key];
    }

    let query = this.db
      .select()
      .from(this.schema)
      .where(and(...buildWhereClause(this.schema, conditions)))
      .$dynamic();

    const orderBy = buildOrderBy(this.schema, sortOptions);
    if (orderBy.length > 0) { query = query.orderBy(...orderBy); }
    if (limit !== undefined) { query = query.limit(limit); }

    this._concurrentQueries[key] = query.then((result) => {
      delete this._concurrentQueries[key];
      return result.map((room) => room as IRoomCache);
    });

    return this._concurrentQueries[key];
  }

  public async update(room: IRoomCache, operations: Partial<{ $set: Partial<IRoomCache>, $inc: Partial<IRoomCache> }>) {
    const setFields: any = {};

    if (operations.$set) {
      for (const field in operations.$set) {
        if (operations.$set.hasOwnProperty(field)) {
          setFields[field] = operations.$set[field];
        }
      }
    }

    if (operations.$inc) {
      for (const field in operations.$inc) {
        if (operations.$inc.hasOwnProperty(field)) {
          const value = operations.$inc[field];
          setFields[field] = (value >= 0)
            ? sql`${this.schema[field]} + ${value}::integer`
            : sql`${this.schema[field]} - ${Math.abs(value)}::integer`;
        }
      }
    }

    await this.db
      .update(this.schema)
      .set(setFields)
      .where(eq(this.schema.roomId, room.roomId))
      .execute();

    return true;
  }

  public async persist(room: IRoomCache, create: boolean = false) {
    if (!room.roomId) {
      debugMatchMaking("DrizzleDriver: can't .persist() without a `roomId`");
      return false;
    }

    if (create) {
      // Create new record
      const insertFields: any = sanitizeRoomData(room);
      await this.db.insert(this.schema).values(insertFields);

    } else {
      // Update existing record
      const updateFields: any = sanitizeRoomData(room);
      delete updateFields.roomId; // Don't update the primary key
      await this.update(room, { $set: updateFields });
    }

    return true;
  }

  public async remove(roomId: string) {
    const result = await this.db
      .delete(this.schema)
      .where(eq(this.schema.roomId, roomId))
      .returning();
    return result.length > 0;
  }

  public async shutdown() {
    // Only close the connection if we created it ourselves
    if (this.sql) {
      await this.sql.end();
      this.sql = undefined;
    }
  }

  //
  // only relevant for the test-suite.
  // not used during runtime.
  //
  public async clear() {
    // skip if already shut down.
    if (!this.sql) { return; }

    const tableConfig = getTableConfig(this.schema);

    // Drop the table completely to ensure schema is fresh
    await this.sql`DROP TABLE IF EXISTS ${this.sql(tableConfig.name)} CASCADE`;

    // Recreate the table using schema definition
    await this.sql.unsafe(generateCreateTableSQL(tableConfig));
  }

}
