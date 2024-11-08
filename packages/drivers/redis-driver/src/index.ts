import Redis, { Cluster, ClusterNode, ClusterOptions, RedisOptions } from 'ioredis';

import {
  IRoomListingData,
  MatchMakerDriver,
  QueryHelpers,
  RoomListingData,
  debugMatchMaking,
  logger,
} from '@colyseus/core';

import { Query } from './Query';
import { RoomData } from './RoomData';

const ROOMCACHES_KEY = 'roomcaches';

export class RedisDriver implements MatchMakerDriver {
  private readonly _client: Redis | Cluster;

  constructor(options?: number | string | RedisOptions | ClusterNode[], clusterOptions?: ClusterOptions) {
    this._client = (Array.isArray(options))
      ? new Cluster(options, clusterOptions)
      : new Redis(options as RedisOptions);
  }

  public createInstance(initialValues: Partial<IRoomListingData> = {}) {
    return new RoomData(initialValues, this._client);
  }

  public async has(roomId: string) {
    return await this._client.hexists(ROOMCACHES_KEY, roomId) === 1;
  }

  public async find(conditions: Partial<IRoomListingData>) {
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
    const cachedRooms = await this.find({ processId });
    debugMatchMaking("removing stale rooms by processId %s (%s rooms found)", processId, cachedRooms.length);

    const itemsPerCommand = 500;

    // remove rooms in batches of 500
    for (let i = 0; i < cachedRooms.length; i += itemsPerCommand) {
      await this._client.hdel(ROOMCACHES_KEY, ...cachedRooms.slice(i, i + itemsPerCommand).map((room) => room.roomId));
    }
  }

  public findOne(conditions: Partial<IRoomListingData>): QueryHelpers<RoomListingData> {
    if (typeof conditions.roomId !== 'undefined') {
      // get room by roomId

      //
      // TODO: refactor driver APIs.
      // the API here is legacy from MongooseDriver which made sense on versions <= 0.14.0
      //

      // @ts-ignore
      return new Promise<RoomListingData>((resolve, reject) => {
        this._client.hget(ROOMCACHES_KEY, conditions.roomId).then((roomcache) => {
          if (roomcache) {
            resolve(new RoomData(JSON.parse(roomcache), this._client));
          } else {
            resolve(undefined);
          }
        }).catch(reject);
      });

    } else {
      // filter list by other conditions
      return (new Query<RoomListingData>(this.getRooms(conditions['name']), conditions) as any) as QueryHelpers<RoomListingData>;
    }
  }

  // gets recent room caches w/o making multiple simultaneous reads to REDIS
  private _concurrentRoomCacheRequest?: Promise<Record<string, string>>;
  private _roomCacheRequestByName: {[roomName: string]: Promise<RoomData[]>} = {};
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
