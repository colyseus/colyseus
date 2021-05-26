import redis, { RedisClient, ClientOpts } from 'redis';
import { promisify } from 'util';
import {
  MatchMakerDriver,
  QueryHelpers,
  RoomListingData,
} from '../Driver';
import { Query } from './Query';
import { RoomData } from './RoomData';
import { setRedisClient } from './client';

export class RedisDriver implements MatchMakerDriver {
  protected readonly client: RedisClient;
  private readonly hgetall: (key: string) => Promise<{ [key: string]: string }>;

  constructor(options: ClientOpts, key: string = 'roomcaches') {
    this.client = redis.createClient(options);
    this.hgetall = promisify(this.client.hgetall).bind(this.client);

    setRedisClient(this.client);
  }

  public createInstance(initialValues: any = {}) {
    return new RoomData(initialValues);
  }

  public async find(conditions: any) {
    return this.rooms.then((rooms) =>
      rooms.filter((room) => {
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
      })
    );
  }

  public findOne(conditions: any) {
    return (new Query<RoomListingData>(
      this.rooms,
      conditions
    ) as any) as QueryHelpers<RoomListingData>;
  }

  public get rooms() {
    return this.hgetall('roomcaches').then((data) =>
      Object.entries(data ?? []).map(
        ([, room]) => new RoomData(JSON.parse(room))
      )
    );
  }

  public quit() {
    this.client.quit();
  }
}
