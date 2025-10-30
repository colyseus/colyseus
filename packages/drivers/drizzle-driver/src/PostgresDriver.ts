import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { pgTable, text, integer, boolean, timestamp, jsonb, getTableConfig } from 'drizzle-orm/pg-core';
import { eq, and } from 'drizzle-orm';

import {
  type IRoomCache,
  type MatchMakerDriver,
  type SortOptions,
  debugMatchMaking,
  initializeRoomCache,
} from '@colyseus/core';

import { sanitizeRoomData, generateCreateTableSQL } from './utils.ts';

// Define the roomcaches table schema using Drizzle
export const roomcaches = pgTable('roomcaches', {
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
      this.db = drizzle(this.sql);
    }
  }

  public async boot() {
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
    const rooms = await this.getRooms();
    return rooms.filter((room) => {
      if (!room.roomId) {
        return false;
      }

      for (const field in conditions) {
        if (
          conditions.hasOwnProperty(field) &&
          room[field] !== conditions[field]
        ) {
          return false;
        }
      }
      return true;
    });
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
      // get room by roomId

      //
      // TODO: refactor driver APIs.
      // the API here is legacy from MongooseDriver which made sense on versions <= 0.14.0
      //

      const result = await this.db
        .select()
        .from(this.schema)
        .where(eq(this.schema.roomId, conditions.roomId))
        .limit(1);

      if (result.length > 0) {
        return initializeRoomCache(result[0] as any);
      }

    } else {
      // filter list by other conditions
      const rooms = await this.getRooms(conditions['name']);
      const filtered = rooms.filter((room) => {
        for (const field in conditions) {
          if (conditions.hasOwnProperty(field) && room[field] !== conditions[field]) {
            return false;
          }
        }
        return true;
      });

      return filtered[0];
    }
  }

  private _concurrentRoomCacheRequest?: Promise<IRoomCache[]>;
  private _roomCacheRequestByName: { [roomName: string]: Promise<IRoomCache[]> } = {};
  private getRooms(roomName?: string) {
    // if there's a shared request, return it
    if (this._roomCacheRequestByName[roomName] !== undefined) {
      return this._roomCacheRequestByName[roomName];
    }

    const roomCacheRequest = this._concurrentRoomCacheRequest || (async () => {
      const result = await this.db.select().from(this.schema);
      return result.map((room) => initializeRoomCache(room as any));
    })();

    this._concurrentRoomCacheRequest = roomCacheRequest;

    this._roomCacheRequestByName[roomName] = roomCacheRequest.then((rooms) => {
      // clear shared promises so we can read it again
      this._concurrentRoomCacheRequest = undefined;
      delete this._roomCacheRequestByName[roomName];

      //
      // filter rooms by name if specified
      //
      if (roomName !== undefined) {
        return rooms.filter((room) => room.name === roomName);
      }

      return rooms;
    });

    return this._roomCacheRequestByName[roomName];
  }

  public async update(room: IRoomCache, operations: Partial<{ $set: Partial<IRoomCache>, $inc: Partial<IRoomCache> }>) {
    if (operations.$set) {
      for (const field in operations.$set) {
        if (operations.$set.hasOwnProperty(field)) {
          room[field] = operations.$set[field];
        }
      }
    }

    if (operations.$inc) {
      for (const field in operations.$inc) {
        if (operations.$inc.hasOwnProperty(field)) {
          room[field] += operations.$inc[field];
        }
      }
    }

    // Update in database
    const updateFields = sanitizeRoomData(room);
    delete updateFields.roomId; // Don't update the primary key

    await this.db
      .update(this.schema)
      .set(updateFields)
      .where(eq(this.schema.roomId, room.roomId));

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

      await this.db
        .update(this.schema)
        .set(updateFields)
        .where(eq(this.schema.roomId, room.roomId));
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
    }
  }

  //
  // only relevant for the test-suite.
  // not used during runtime.
  //
  public async clear() {
    const tableConfig = getTableConfig(this.schema);

    // Drop the table completely to ensure schema is fresh
    await this.sql`DROP TABLE IF EXISTS ${this.sql(tableConfig.name)} CASCADE`;

    // Recreate the table using schema definition
    await this.sql.unsafe(generateCreateTableSQL(tableConfig));
  }

}
