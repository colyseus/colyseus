import { RoomListingData } from '@colyseus/core';
import Redis from 'ioredis';

export class RoomData implements RoomListingData {
  public clients: number = 0;
  public locked: boolean = false;
  public private: boolean = false;
  public maxClients: number = Infinity;
  public metadata: any;
  public name: string;
  public processId: string;
  public roomId: string;
  public createdAt: Date;
  public unlisted: boolean = false;

  #client: Redis.Redis;

  constructor(
    initialValues: any,
    client: Redis.Redis,
    private readonly key: string,
  ) {
    this.#client = client;

    this.createdAt = initialValues.createdAt
      ? new Date(initialValues.createdAt)
      : new Date();

    for (const field in initialValues) {
      if (initialValues.hasOwnProperty(field)) {
        this[field] = initialValues[field];
      }
    }
  }

  public toJSON() {
    return {
      clients: this.clients,
      createdAt: this.createdAt,
      maxClients: this.maxClients,
      metadata: this.metadata,
      name: this.name,
      processId: this.processId,
      roomId: this.roomId,
    };
  }

  public async save() {
    if (this.roomId) {
      // FIXME: workaround so JSON.stringify() stringifies all dynamic fields.
      const toJSON = this.toJSON;
      this.toJSON = undefined;

      const roomcache = JSON.stringify(this);
      this.toJSON = toJSON;

      await this.hset(this.key, this.roomId, roomcache);

    } else {
      console.warn("⚠️ RedisDriver: can't .save() without a `roomId`")
    }
  }

  public updateOne(operations: any) {
    if (operations.$set) {
      for (const field in operations.$set) {
        if (operations.$set.hasOwnProperty(field)) {
          this[field] = operations.$set[field];
        }
      }
    }

    if (operations.$inc) {
      for (const field in operations.$inc) {
        if (operations.$inc.hasOwnProperty(field)) {
          this[field] += operations.$inc[field];
        }
      }
    }

    return this.save();
  }

  public remove() {
    if (this.roomId) {
      return this.hdel(this.key, this.roomId);
    }
  }

  private async hset(key: string, field: string, value: string) {
    return await this.#client.hset(key, field, value);
  }

  private async hdel(key: string, field: string) {
    return await this.#client.hdel(key, field);
  }
}
