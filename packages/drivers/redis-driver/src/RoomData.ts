import { type IRoomCache, logger } from '@colyseus/core';
import { Redis, type Cluster } from 'ioredis';

export class RoomData implements IRoomCache {
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
}
