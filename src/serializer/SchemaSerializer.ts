import { Client } from '..';
import { Serializer } from './Serializer';

import { Definition, Reflection, Schema } from '@colyseus/schema';
import { debugPatch } from '../Debug';
import { Protocol, send } from '../Protocol';

export class SchemaSerializer<T> implements Serializer<T> {
  public id = 'schema';

  private state: T & Schema;
  private hasFiltersByClient: boolean = false;

  private handshakeCache: number[];

  public reset(newState: T & Schema) {
    if (!(newState instanceof Schema)) {
      throw new Error(`SchemaSerializer error. See: https://docs.colyseus.io/migrating/0.10/#new-default-serializer`);
    }
    this.state = newState;
    this.hasFiltersByClient = this.hasFilter(newState._schema, newState._filters);
  }

  public getFullState(client: Client) {
    return (this.hasFiltersByClient)
      ? this.state.encodeAllFiltered(client)
      : this.state.encodeAll();
  }

  public applyPatches(clients: Client[]) {
    const hasChanges = this.state.$changed;

    if (hasChanges) {
      let numClients = clients.length;

      if (!this.hasFiltersByClient) {

        // encode changes once, for all clients
        const patches = this.state.encode();
        patches.unshift(Protocol.ROOM_STATE_PATCH);

        while (numClients--) {
          const client = clients[numClients];
          send.raw(client, patches);
        }

        if (debugPatch.enabled) {
          debugPatch('%d bytes sent to %d clients', patches.length, clients.length);
        }

      } else {

        // encode state multiple times, for each client
        while (numClients--) {
          const client = clients[numClients];
          send.raw(client, [Protocol.ROOM_STATE_PATCH, ...this.state.encodeFiltered(client)]);
        }

        this.state.discardAllChanges();

      }
    }

    return hasChanges;
  }

  public handshake() {
    /**
     * Cache handshake to avoid encoding it for each client joining
     */
    if (!this.handshakeCache) {
      this.handshakeCache = (this.state && Reflection.encode(this.state));
    }

    return this.handshakeCache;
  }

  public hasFilter(schema: Definition, filters: any = {}) {
    let hasFilter = false;

    for (const fieldName of Object.keys(schema)) {
      // skip if a filter has been found
      if (hasFilter) { break; }

      if (filters[fieldName]) {
        hasFilter = true;

      } else if (typeof (schema[fieldName]) === 'function') {
        const childSchema = (schema[fieldName] as typeof Schema)._schema;
        const childFilters = (schema[fieldName] as typeof Schema)._filters;
        hasFilter = this.hasFilter(childSchema, childFilters);

      } else if (Array.isArray(schema[fieldName])) {
        const childSchema = (schema[fieldName][0] as typeof Schema)._schema;
        const childFilters = (schema[fieldName][0] as typeof Schema)._filters;
        hasFilter = this.hasFilter(childSchema, childFilters);

      } else if ((schema[fieldName] as any).map) {
        const childSchema = ((schema[fieldName] as any).map as typeof Schema)._schema;
        const childFilters = ((schema[fieldName] as any).map as typeof Schema)._filters;
        hasFilter = this.hasFilter(childSchema, childFilters);

      }
    }

    return hasFilter;
  }
}
