import {
  IRoomListingData,
  MatchMakerDriver,
  QueryHelpers,
  RoomListingData,
} from '@colyseus/core';
import Redis from 'ioredis';

import { Query } from './Query';
import { RoomData } from './RoomData';

export class RedisDriver implements MatchMakerDriver {
  private readonly _client: Redis.Redis;

  constructor(options?: Redis.RedisOptions, key: string = 'roomcaches') {
    this._client = new Redis(options);
  }

  public createInstance(initialValues: any = {}) {
    return new RoomData(initialValues, this._client);
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
    return Object.entries(await this._client.hgetall('roomcaches') ?? []).map(
      ([, roomcache]) => new RoomData(JSON.parse(roomcache), this._client),
    );
  }

  public async shutdown() {
    await this._client.quit();
  }

  //
  // only relevant for the test-suite.
  // not used during runtime.
  //
  public async clear() {
    await this._client.del('roomcaches');
  }
}
