import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { pgTable, text, integer, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { eq, and } from 'drizzle-orm';

import {
  type IRoomCache,
  type MatchMakerDriver,
  type SortOptions,
  debugMatchMaking,
  initializeRoomCache,
} from '@colyseus/core';

// Define the roomcaches table schema using Drizzle
export const roomcaches = pgTable('roomcaches', {
  roomId: text('roomId').primaryKey(),
  clients: integer('clients').notNull(),
  locked: boolean('locked'),
  private: boolean('private'),
  maxClients: integer('maxClients').notNull(),
  metadata: jsonb('metadata'),
  name: text('name').notNull(),
  publicAddress: text('publicAddress'),
  processId: text('processId').notNull(),
  createdAt: timestamp('createdAt'),
  unlisted: boolean('unlisted'),
});

export type RoomCache = typeof roomcaches.$inferSelect;

// Helper function to sanitize room data before persisting
function sanitizeRoomData(room: Partial<IRoomCache>): any {
  const sanitized: any = { ...room };

  // Convert Infinity to a large number for database storage
  if (sanitized.maxClients === Infinity) {
    sanitized.maxClients = 2147483647; // Max integer value in PostgreSQL
  }

  // Provide default values for required fields if they're missing
  if (!sanitized.name) {
    sanitized.name = '';
  }
  if (!sanitized.processId) {
    sanitized.processId = '';
  }

  // Remove methods that shouldn't be persisted
  delete sanitized.toJSON;

  return sanitized;
}

export class DrizzleDriver implements MatchMakerDriver {
  private sql: ReturnType<typeof postgres>;
  private db: PostgresJsDatabase;
  private readonly connectionUrl: string;
  private schema: typeof roomcaches;

  constructor(options?: {
    db?: PostgresJsDatabase;
    schema?: typeof roomcaches;
  }) {
    // Use provided schema or default
    this.schema = options?.schema || roomcaches;

    // Use provided db instance if available
    if (options?.db) {
      this.db = options.db;
      this.sql = null as any; // User is managing their own connection
      this.connectionUrl = '';
    } else {
      // Create db from DATABASE_URL environment variable
      this.connectionUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
      this.sql = postgres(this.connectionUrl);
      this.db = drizzle(this.sql);
    }
  }

  public async boot() {
    // In test/development mode, drop the table first to ensure fresh schema
    // This prevents migration errors when schema changes between runs
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      try {
        await this.sql`DROP TABLE IF EXISTS roomcaches CASCADE`;
        debugMatchMaking("Dropped roomcaches table for fresh schema");
      } catch (error) {
        // Ignore errors - table might not exist
        debugMatchMaking("Could not drop roomcaches table before boot:", error);
      }
    }

    // Create table (always, since we drop in test mode)
    try {
      await this.sql`
        CREATE TABLE IF NOT EXISTS roomcaches (
          "roomId" TEXT PRIMARY KEY,
          clients INTEGER NOT NULL,
          locked BOOLEAN,
          private BOOLEAN,
          "maxClients" INTEGER NOT NULL,
          metadata JSONB,
          name TEXT NOT NULL,
          "publicAddress" TEXT,
          "processId" TEXT NOT NULL,
          "createdAt" TIMESTAMP,
          unlisted BOOLEAN
        )
      `;
      debugMatchMaking("Created roomcaches table");
    } catch (error) {
      debugMatchMaking("Error creating roomcaches table:", error);
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
      .returning();
    const deletedCount = result.length;
    debugMatchMaking("removing stale rooms by processId %s (%s rooms found)", processId, deletedCount);
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
    const updateFields: any = sanitizeRoomData(room);
    delete updateFields.roomId; // Don't update the primary key

    await this.db
      .update(this.schema)
      .set(updateFields)
      .where(eq(this.schema.roomId, room.roomId));

    return true;
  }

  public async persist(room: IRoomCache) {
    if (!room.roomId) {
      debugMatchMaking("PostgresDriver: can't .persist() without a `roomId`");
      return false;
    }

    // Check if room exists
    const exists = await this.has(room.roomId);

    if (exists) {
      // Update existing record
      const updateFields: any = sanitizeRoomData(room);
      delete updateFields.roomId; // Don't update the primary key

      await this.db
        .update(this.schema)
        .set(updateFields)
        .where(eq(this.schema.roomId, room.roomId));
    } else {
      // Create new record
      const insertFields: any = sanitizeRoomData(room);

      await this.db.insert(this.schema).values(insertFields);
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
    // Drop the table completely to ensure schema is fresh
    await this.sql`DROP TABLE IF EXISTS roomcaches CASCADE`;

    // Recreate the table
    await this.sql`
      CREATE TABLE IF NOT EXISTS roomcaches (
        "roomId" TEXT PRIMARY KEY,
        clients INTEGER NOT NULL,
        locked BOOLEAN,
        private BOOLEAN,
        "maxClients" INTEGER NOT NULL,
        metadata JSONB,
        name TEXT NOT NULL,
        "publicAddress" TEXT,
        "processId" TEXT NOT NULL,
        "createdAt" TIMESTAMP,
        unlisted BOOLEAN
      )
    `;
  }

}
