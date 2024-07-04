import { RoomCache, logger } from '@colyseus/core';
import Redis, { Cluster } from 'ioredis';

export class RoomData implements RoomCache {
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

  #client: Redis | Cluster;
  #removed: boolean = false;

  constructor(
    initialValues: any,
    client: Redis | Cluster
  ) {
    this.#client = client;

    this.createdAt = (initialValues && initialValues.createdAt)
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
      publicAddress: this.publicAddress,
      processId: this.processId,
      roomId: this.roomId,
    };
  }

  public async save() {
    // skip if already removed.
    if (this.#removed) { return; }

    if (this.roomId) {
      // FIXME: workaround so JSON.stringify() stringifies all dynamic fields.
      const toJSON = this.toJSON;
      this.toJSON = undefined;

      const roomcache = JSON.stringify(this);
      this.toJSON = toJSON;

      await this.hset('roomcaches', this.roomId, roomcache);

    } else {
      logger.warn("RedisDriver: can't .save() without a `roomId`")
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
      this.#removed = true;
      return this.hdel('roomcaches', this.roomId);
    }
  }

  private async hset(key: string, field: string, value: string) {
    return await this.#client.hset(key, field, value);
  }

  private async hdel(key: string, field: string) {
    return await this.#client.hdel(key, field);
  }
}
