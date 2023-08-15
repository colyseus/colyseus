import Redis, { Cluster, ClusterNode, ClusterOptions, RedisOptions } from 'ioredis';

import {
  IRoomListingData,
  MatchMakerDriver,
  QueryHelpers,
  RoomListingData,
} from '@colyseus/core';

import { Query } from './Query';
import { RoomData } from './RoomData';

export class RedisDriver implements MatchMakerDriver {
  private readonly _client: Redis | Cluster;

  constructor(options?: RedisOptions | ClusterNode[], clusterOptions?: ClusterOptions) {
    this._client = (Array.isArray(options))
      ? new Cluster(options, clusterOptions)
      : new Redis(options);
  }

  public createInstance(initialValues: any = {}) {
    return new RoomData(initialValues, this._client);
  }

  public async has(roomId: string) {
    return await this._client.hexists('roomcaches', roomId) === 1;
  }

  public async find(conditions: any) {
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

  public findOne(conditions: Partial<IRoomListingData>): QueryHelpers<RoomListingData> {
    if (typeof conditions.roomId !== 'undefined') {
      // get room by roomId

      //
      // TODO: refactor driver APIs.
      // the API here is legacy from MongooseDriver which made sense on versions <= 0.14.0
      //

      // @ts-ignore
      return new Promise<RoomListingData>((resolve, reject) => {
        this._client.hget('roomcaches', conditions.roomId).then((roomcache) => {
          if (roomcache) {
            resolve(new RoomData(JSON.parse(roomcache), this._client));
          } else {
            resolve(undefined);
          }
        }).catch(reject);
      });

    } else {
      // filter list by other conditions
      return (new Query<RoomListingData>(this.getRooms(), conditions) as any) as QueryHelpers<RoomListingData>;
    }
  }

  public async getRooms() {
    return Object.entries(await this._client.hgetall('roomcaches') ?? []).map(
      ([, roomcache]) => new RoomData(JSON.parse(roomcache), this._client)
    );
  }

  public async shutdown() {
    await this._client.quit();
  }

  //
  // only relevant for the test-suite.
  // not used during runtime.
  //
  public clear() {
    this._client.del('roomcaches');
  }

}
