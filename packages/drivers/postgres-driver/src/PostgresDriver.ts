import { Collection, connect, Database, z } from 'zodgres';
import * as zod from 'zod';

import {
  type IRoomCache,
  type MatchMakerDriver,
  type SortOptions,
  debugMatchMaking,
} from '@colyseus/core';

import { RoomData } from './RoomData.ts';

export class PostgresDriver<T extends zod.core.$ZodLooseShape> implements MatchMakerDriver {
  private readonly _db: Database;
  private readonly _roomcaches: Collection<T>;

  constructor(
    db: Database = connect(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres'),
    roomCacheSchema: T = {
      roomId: z.string(),
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
    this._db = db;

    // define database collections
    this._roomcaches = db.collection('roomcaches', roomCacheSchema);
  }

  public createInstance(initialValues: Partial<IRoomCache> = {}) {
    return new RoomData(initialValues, this._roomcaches);
  }

  public async has(roomId: string) {
    return (await this._roomcaches.selectOne`roomId = ${roomId}`) !== undefined;
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
    const deletedCount = await this._roomcaches.delete`WHERE processId = ${processId}`;
    debugMatchMaking("removing stale rooms by processId %s (%s rooms found)", processId, deletedCount);
  }

  public async findOne(conditions: Partial<IRoomCache>, sortOptions?: SortOptions): Promise<RoomData> {
    if (typeof conditions.roomId !== 'undefined') {
      // get room by roomId

      //
      // TODO: refactor driver APIs.
      // the API here is legacy from MongooseDriver which made sense on versions <= 0.14.0
      //

      const room = await this._roomcaches.selectOne`roomId = ${conditions.roomId}`;

      if (room) {
        return new RoomData(room, this._roomcaches);
      }

    } else {
      // filter list by other conditions
      const query = new Query<RoomData>(this.getRooms(conditions['name']), conditions);

      if (sortOptions) {
        query.sort(sortOptions);
      }

      return query as any as Promise<RoomData>;
    }
  }

  // gets recent room caches w/o making multiple simultaneous reads to REDIS
  private _concurrentRoomCacheRequest?: Promise<Record<string, string>>;
  private _roomCacheRequestByName: { [roomName: string]: Promise<RoomData[]> } = {};
  private getRooms(roomName?: string) {
    // if there's a shared request, return it
    if (this._roomCacheRequestByName[roomName] !== undefined) {
      return this._roomCacheRequestByName[roomName];
    }

    const roomCacheRequest = this._concurrentRoomCacheRequest || this._client.hgetall(ROOMCACHES_KEY);
    this._concurrentRoomCacheRequest = roomCacheRequest;

    this._roomCacheRequestByName[roomName] = roomCacheRequest.then((result) => {
      // clear shared promises so we can read it again
      this._concurrentRoomCacheRequest = undefined;
      delete this._roomCacheRequestByName[roomName];

      let roomcaches = Object.entries(result ?? []);

      //
      // micro optimization:
      // filter rooms by name before parsing JSON
      //
      if (roomName !== undefined) {
        const roomNameField = `"name":"${roomName}"`;
        roomcaches = roomcaches.filter(([, roomcache]) => roomcache.includes(roomNameField));
      }

      return roomcaches.map(
        // TODO: probably no need to instantiate RoomData here.
        ([, roomcache]) => new RoomData(JSON.parse(roomcache), this._client)
      );
    });

    return this._roomCacheRequestByName[roomName];
  }

  public async shutdown() {
    await this._client.quit();
  }

  //
  // only relevant for the test-suite.
  // not used during runtime.
  //
  public clear() {
    this._client.del(ROOMCACHES_KEY);
  }

}
