import {
  Redis,
  Cluster,
  type ClusterNode,
  type ClusterOptions,
  type RedisOptions
} from 'ioredis';

import {
  type IRoomCache,
  type MatchMakerDriver,
  type SortOptions,
  debugMatchMaking,
  initializeRoomCache,
} from '@colyseus/core';

import { Query } from './Query.ts';

const ROOMCACHES_KEY = 'roomcaches';

export class RedisDriver implements MatchMakerDriver {
  private readonly _client: Redis | Cluster;

  constructor(options?: number | string | RedisOptions | ClusterNode[], clusterOptions?: ClusterOptions) {
    this._client = (Array.isArray(options))
      ? new Cluster(options, clusterOptions)
      : new Redis(options as RedisOptions);
  }

  public async has(roomId: string) {
    return await this._client.hexists(ROOMCACHES_KEY, roomId) === 1;
  }

  public async query(conditions: Partial<IRoomCache>, sortOptions?: SortOptions) {
    const query = new Query<IRoomCache>(this.getRooms(), conditions);

    if (sortOptions) {
      query.sort(sortOptions);
    }

    return query.all();

  }

  public async cleanup(processId: string) {
    const cachedRooms = await this.query({ processId });
    debugMatchMaking("removing stale rooms by processId %s (%s rooms found)", processId, cachedRooms.length);

    const itemsPerCommand = 500;

    // remove rooms in batches of 500
    for (let i = 0; i < cachedRooms.length; i += itemsPerCommand) {
      await this._client.hdel(ROOMCACHES_KEY, ...cachedRooms.slice(i, i + itemsPerCommand).map((room) => room.roomId));
    }
  }

  public findOne(conditions: Partial<IRoomCache>, sortOptions?: SortOptions): Promise<IRoomCache> {
    if (typeof conditions.roomId !== 'undefined') {
      // get room by roomId

      //
      // TODO: refactor driver APIs.
      // the API here is legacy from MongooseDriver which made sense on versions <= 0.14.0
      //

      return new Promise<IRoomCache>((resolve, reject) => {
        this._client.hget(ROOMCACHES_KEY, conditions.roomId).then((roomcache) => {
          if (roomcache) {
            resolve(initializeRoomCache(JSON.parse(roomcache)));
          } else {
            resolve(undefined);
          }
        }).catch(reject);
      });

    } else {
      // filter list by other conditions
      const query = new Query<IRoomCache>(this.getRooms(conditions['name']), conditions);

      if (sortOptions) {
        query.sort(sortOptions);
      }

      return query as any as Promise<IRoomCache>;
    }
  }

  // gets recent room caches w/o making multiple simultaneous reads to REDIS
  private _concurrentRoomCacheRequest?: Promise<Record<string, string>>;
  private _roomCacheRequestByName: {[roomName: string]: Promise<IRoomCache[]>} = {};
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

      let roomcaches = Object.entries(result ?? {});

      //
      // micro optimization:
      // filter rooms by name before parsing JSON
      //
      if (roomName !== undefined) {
        const roomNameField = `"name":"${roomName}"`;
        roomcaches = roomcaches.filter(([, roomcache]) => (roomcache as string).includes(roomNameField));
      }

      return roomcaches.map(
        ([, roomcache]) => initializeRoomCache(JSON.parse(roomcache as string))
      );
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

    await this._client.hset(ROOMCACHES_KEY, room.roomId, JSON.stringify(room));
    return true;
  }

  public async persist(room: IRoomCache, _: boolean = false) {
    if (!room.roomId) {
      debugMatchMaking("RedisDriver: can't .persist() without a `roomId`");
      return false;
    }

    await this._client.hset(ROOMCACHES_KEY, room.roomId, JSON.stringify(room));
    return true;
  }

  public async remove(roomId: string) {
    const result = await this._client.hdel(ROOMCACHES_KEY, roomId);
    return result > 0;
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