import { RoomListingData } from '@colyseus/core';
import Redis from 'ioredis';

export class RoomData implements RoomListingData {
  public clients: number = 0;
  public locked: boolean = false;
  public private: boolean = false;
  public maxClients: number = Infinity;
  public metadata: any;
  public name: string;
  public publicAddress: string;
  public processId: string;
  public roomId: string;
  public createdAt: Date;
  public unlisted: boolean = false;

  #client: Redis.Redis;

  constructor(
    initialValues: any,
    client: Redis.Redis,
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
      publicAddress: this.publicAddress,
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

      await this.hset('roomcaches', this.roomId, roomcache);
    } else {
      console.warn('⚠️ RedisDriver: can\'t .save() without a `roomId`');
    }
  }

  public async updateOne(operations: any) {
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

    await this.save();
  }

  public async remove() {
    if (this.roomId) {
      return await this.hdel('roomcaches', this.roomId);
    }
    return 0;
  }

  private async hset(key: string, field: string, value: string) {
    return await this.#client.hset(key, field, value);
  }

  private async hdel(key: string, field: string) {
    return await this.#client.hdel(key, field);
  }
}
