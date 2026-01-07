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

import { FILTER_AND_SORT_SCRIPT, FIND_ONE_SCRIPT } from './luaScripts.ts';

const ROOMCACHES_KEY = 'roomcaches';

export class RedisDriver implements MatchMakerDriver {
  private readonly _client: Redis | Cluster;

  // Cache concurrent filterAndSort requests to avoid redundant Redis calls
  private _pendingFilterRequests: Map<string, Promise<string[]>> = new Map();
  private _pendingFindOneRequests: Map<string, Promise<string | null>> = new Map();

  constructor(options?: number | string | RedisOptions | ClusterNode[], clusterOptions?: ClusterOptions) {
    this._client = (Array.isArray(options))
      ? new Cluster(options, clusterOptions)
      : new Redis(options as RedisOptions);
  }

  public async has(roomId: string) {
    return await this._client.hexists(ROOMCACHES_KEY, roomId) === 1;
  }

  public async query(conditions: Partial<IRoomCache>, sortOptions?: SortOptions) {
    const conditionsJson = JSON.stringify(conditions || {});
    const sortOptionsJson = sortOptions ? JSON.stringify(sortOptions) : '';
    const cacheKey = `${conditionsJson}:${sortOptionsJson}`;

    // Check if there's already a pending request with the same parameters
    let pendingRequest = this._pendingFilterRequests.get(cacheKey);

    if (!pendingRequest) {
      // Create new request and cache it
      pendingRequest = (this._client as any).filterAndSort(
        ROOMCACHES_KEY,
        conditionsJson,
        sortOptionsJson
      ) as Promise<string[]>;

      this._pendingFilterRequests.set(cacheKey, pendingRequest);

      // Clean up cache after request completes
      pendingRequest.finally(() => {
        this._pendingFilterRequests.delete(cacheKey);
      });
    }

    const results = await pendingRequest;
    return results.map((roomcache) => initializeRoomCache(JSON.parse(roomcache)));
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

  public async findOne(conditions: Partial<IRoomCache>, sortOptions?: SortOptions): Promise<IRoomCache> {
    if (typeof conditions.roomId !== 'undefined') {
      // get room by roomId

      //
      // TODO: refactor driver APIs.
      // the API here is legacy from MongooseDriver which made sense on versions <= 0.14.0
      //

      const roomcache = await this._client.hget(ROOMCACHES_KEY, conditions.roomId);
      if (roomcache) {
        return initializeRoomCache(JSON.parse(roomcache));
      }
      return undefined;

    } else {
      // Use Lua script to find first matching room in Redis
      const conditionsJson = JSON.stringify(conditions || {});
      const sortOptionsJson = sortOptions ? JSON.stringify(sortOptions) : '';
      const cacheKey = `${conditionsJson}:${sortOptionsJson}`;

      // Check if there's already a pending request with the same parameters
      let pendingRequest = this._pendingFindOneRequests.get(cacheKey);

      if (!pendingRequest) {
        // Create new request and cache it
        pendingRequest = (this._client as any).findOneRoom(
          ROOMCACHES_KEY,
          conditionsJson,
          sortOptionsJson
        ) as Promise<string | null>;

        this._pendingFindOneRequests.set(cacheKey, pendingRequest);

        // Clean up cache after request completes
        pendingRequest.finally(() => {
          this._pendingFindOneRequests.delete(cacheKey);
        });
      }

      const result = await pendingRequest;

      if (result) {
        return initializeRoomCache(JSON.parse(result));
      }
      return undefined;
    }
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

  public async boot() {
    // Define custom Lua commands for filtering and sorting
    // ioredis defineCommand works for both Redis and Cluster instances
    (this._client as any).defineCommand('filterAndSort', {
      numberOfKeys: 1,
      lua: FILTER_AND_SORT_SCRIPT,
    });

    (this._client as any).defineCommand('findOneRoom', {
      numberOfKeys: 1,
      lua: FIND_ONE_SCRIPT,
    });
  }

  //
  // only relevant for the test-suite.
  // not used during runtime.
  //
  public clear() {
    this._client.del(ROOMCACHES_KEY);
  }

}
