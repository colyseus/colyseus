import { Collection, connect, Database, z } from 'zodgres';
import * as zod from 'zod';

import {
  type IRoomCache,
  type MatchMakerDriver,
  type SortOptions,
  debugMatchMaking,
  initializeRoomCache,
} from '@colyseus/core';

export class PostgresDriver<T extends zod.core.$ZodLooseShape> implements MatchMakerDriver {
  private readonly db: Database;
  private readonly collection: Collection<T>;
  private readonly connectionUrl: string;

  constructor(
    connectionUrlOrDb?: string | Database,
    roomCacheSchema: T = {
      roomId: z.string().unique(),
      clients: z.number(),
      locked: z.boolean(),
      private: z.boolean(),
      maxClients: z.number(),
      metadata: z.any(),
      name: z.string(),
      publicAddress: z.string(),
      processId: z.string(),
      createdAt: z.date(),
      unlisted: z.boolean(),
    } as unknown as T
  ) {
    // Handle both connection URL string and Database instance
    if (typeof connectionUrlOrDb === 'string') {
      this.connectionUrl = connectionUrlOrDb;
      this.db = connect(connectionUrlOrDb);
    } else {
      this.connectionUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
      this.db = connectionUrlOrDb ?? connect(this.connectionUrl);
    }

    // define database collections
    this.collection = this.db.collection('roomcaches', roomCacheSchema);
  }

  public async boot() {
    // In test/development mode, drop the table first to ensure fresh schema
    // This prevents migration errors when schema changes between runs
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      try {
        // Access the underlying postgres client from zodgres
        // @ts-ignore - accessing internal sql property
        const sql = this.db.sql;
        if (sql) {
          await sql`DROP TABLE IF EXISTS roomcaches CASCADE`;
        }
      } catch (error) {
        // Ignore errors - table might not exist or sql might not be available yet
        debugMatchMaking("Could not drop roomcaches table before boot:", error);
      }
    }

    await this.db.open();
  }

  public async has(roomId: string) {
    return (await this.collection.selectOne`roomId = ${roomId}`) !== undefined;
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
    const deletedCount = await this.collection.delete`WHERE processId = ${processId}`;
    debugMatchMaking("removing stale rooms by processId %s (%s rooms found)", processId, deletedCount);
  }

  public async findOne(conditions: Partial<IRoomCache>, sortOptions?: SortOptions): Promise<IRoomCache> {
    if (typeof conditions.roomId !== 'undefined') {
      // get room by roomId

      //
      // TODO: refactor driver APIs.
      // the API here is legacy from MongooseDriver which made sense on versions <= 0.14.0
      //

      const room = await this.collection.selectOne`roomId = ${conditions.roomId}`;

      if (room) {
        return initializeRoomCache(room);
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
      const rooms = await this.collection.select();
      return rooms.map((room) => initializeRoomCache(room));
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
    const updateFields = { ...room };
    delete updateFields.roomId; // Don't update the primary key
    delete (updateFields as any).toJSON; // Remove method if present
    // @ts-ignore - zodgres update method with template string
    await (this.collection.update(updateFields as any)`roomId = ${room.roomId}`);
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
      const updateFields: Partial<IRoomCache> = {};
      const fields = Object.keys(room) as (keyof IRoomCache)[];

      // Only persist specified fields
      for (const field of fields) {
        updateFields[field] = room[field];
      }

      // @ts-ignore - zodgres update method with template string
      await (this.collection.update(updateFields as any)`roomId = ${room.roomId}`);
    } else {
      // Create new record
      const insertFields: Partial<IRoomCache> = {};
      const fields = Object.keys(room) as (keyof IRoomCache)[];

      for (const field of fields) {
        insertFields[field] = room[field];
      }

      await this.collection.create(insertFields as any);
    }

    return true;
  }

  public async remove(roomId: string) {
    const deletedCount = await this.collection.delete`WHERE roomId = ${roomId}`;
    return deletedCount > 0;
  }

  public async shutdown() {
    if (!this.db.isOpen) { return; }
    await this.db.close();
  }

  //
  // only relevant for the test-suite.
  // not used during runtime.
  //
  public async clear() {
    // Drop the table completely to ensure schema is fresh
    // @ts-ignore - accessing internal sql property
    await this.db.sql`DROP TABLE IF EXISTS roomcaches CASCADE`;
  }

}
