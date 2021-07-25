import redis, { RedisClient, ClientOpts } from 'redis';
import { promisify } from 'util';

import {
  IRoomListingData,
  MatchMakerDriver,
  QueryHelpers,
  RoomListingData,
} from '@colyseus/core';

import { Query } from './Query';
import { RoomData } from './RoomData';

export class RedisDriver implements MatchMakerDriver {
  private readonly _client: RedisClient;
  private readonly hgetall: (key: string) => Promise<{ [key: string]: string }>;
  public _cachekey: string;

  constructor(options?: ClientOpts, key: string = 'roomcaches') {
    this._cachekey = key;
    this._client = redis.createClient(options);
    this.hgetall = promisify(this._client.hgetall).bind(this._client);
  }

  public createInstance(initialValues: any = {}) {
    return new RoomData(initialValues, this._client, this._cachekey);
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
    return Object.entries(await this.hgetall(this._cachekey) ?? []).map(
      ([, roomcache]) => new RoomData(JSON.parse(roomcache), this._client, this._cachekey)
    );
  }

  public clear() {
    this._client.del(this._cachekey);
  }

  public shutdown() {
    this._client.quit();
  }
}
