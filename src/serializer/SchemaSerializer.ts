import { Client } from '..';
import { Serializer } from './Serializer';

import { Definition, Reflection, Schema } from '@colyseus/schema';
import { Protocol, send } from '../Protocol';

export class SchemaSerializer<T> implements Serializer<T> {
  public id = 'schema';
  private state: T & Schema;
  private hasFiltersByClient: boolean = false;

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
        while (numClients--) {
          const client = clients[numClients];
          send[Protocol.ROOM_STATE_PATCH](client, patches);
        }

      } else {

        // encode state multiple times, for each client
        while (numClients--) {
          const client = clients[numClients];
          send[Protocol.ROOM_STATE_PATCH](client, this.state.encodeFiltered(client));
        }

        throw new Error('filters are not fully implemented yet.');
        // this.state.markAsUnchanged();

      }
    }

    return hasChanges;
  }

  public handshake() {
    return this.state && Reflection.encode(this.state);
  }

  private hasFilter(schema: Definition, filters: any) {
    if (!filters) {
      return false;
    }

    for (const fieldName in schema) {
      if (filters[fieldName]) {
        return true;

      } else if (typeof (schema[fieldName]) === 'function') {
        const childSchema = (schema[fieldName] as typeof Schema)._schema;
        const childFilters = (schema[fieldName] as typeof Schema)._filters;
        return this.hasFilter(childSchema, childFilters);

      } else if (Array.isArray(schema[fieldName])) {
        const childSchema = (schema[fieldName][0] as typeof Schema)._schema;
        const childFilters = (schema[fieldName][0] as typeof Schema)._filters;
        return this.hasFilter(childSchema, childFilters);

      } else if ((schema[fieldName] as any).map) {
        const childSchema = ((schema[fieldName] as any).map as typeof Schema)._schema;
        const childFilters = ((schema[fieldName] as any).map as typeof Schema)._filters;
        return this.hasFilter(childSchema, childFilters);

      }

    }
    return false;
  }
}
