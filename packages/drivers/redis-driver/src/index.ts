import Redis from 'ioredis';

import {
  IRoomListingData,
  MatchMakerDriver,
  QueryHelpers,
  RoomListingData,
} from '@colyseus/core';

import { Query } from './Query';
import { RoomData } from './RoomData';

export class RedisDriver implements MatchMakerDriver {
  private readonly _client: Redis.Redis | Redis.Cluster;

  /**
   * @param options Redis options. Enable cluster mode by passing in an array of Redis connection strings or `ioredis.ClusterNode` objects.
   * @param clusterOptions Extra cluster options passed to `ioredis.Cluster`. Only used in cluster mode.
   * @param key Redis key. Set a non-default value to implement namespacing.
   */
  constructor(options?: Redis.RedisOptions | Redis.ClusterNode[], clusterOptions?: Redis.ClusterOptions, private readonly key = 'roomcaches') {
    if (Array.isArray(options)) {
      this._client = new Redis.Cluster(options, clusterOptions);
    } else {
      this._client = new Redis(options);
    }
  }

  public createInstance(initialValues: any = {}) {
    return new RoomData(initialValues, this._client, this.key);
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
    return (new Query<RoomListingData>(this.getRooms(), conditions) as any) as QueryHelpers<RoomListingData>;
  }

  public async getRooms() {
    return Object.entries(await this._client.hgetall(this.key) ?? []).map(
      ([, roomcache]) => new RoomData(JSON.parse(roomcache), this._client, this.key)
    );
  }

  public clear() {
    this._client.del(this.key);
  }

  public shutdown() {
    this._client.quit();
  }
}
