/* tslint:disable:no-string-literal */

import { Client } from '..';
import { Serializer } from './Serializer';

import { Definition, dumpChanges, Reflection, Schema } from '@colyseus/schema';
import { debugPatch } from '../Debug';
import { Protocol } from '../Protocol';

export class SchemaSerializer<T> implements Serializer<T> {
  public id = 'schema';

  private state: T & Schema;
  private hasFiltersByClient: boolean = false;

  private handshakeCache: number[];

  public reset(newState: T & Schema) {
    this.state = newState;
    this.hasFiltersByClient = this.hasFilter(newState['_schema'] || {}, newState['_filters'] || {});
  }

  public getFullState(client?: Client) {
    return (client && this.hasFiltersByClient)
      ? this.state.encodeAllFiltered(client)
      : this.state.encodeAll();
  }

  public applyPatches(clients: Client[]) {
    const hasChanges = this.state.$changed;

    if (hasChanges) {
      let numClients = clients.length;

      // dump changes for patch debugging
      if (debugPatch.enabled) {
        (debugPatch as any).dumpChanges = dumpChanges(this.state);
      }

      if (!this.hasFiltersByClient) {
        // encode changes once, for all clients
        const patches = this.state.encode();
        patches.unshift(Protocol.ROOM_STATE_PATCH);

        while (numClients--) {
          const client = clients[numClients];
          client.enqueueRaw(patches);
        }

        if (debugPatch.enabled) {
          debugPatch(
            '%d bytes sent to %d clients, %j',
            patches.length,
            clients.length,
            (debugPatch as any).dumpChanges,
          );
        }

      } else {

        // encode state multiple times, for each client
        while (numClients--) {
          const client = clients[numClients];
          client.enqueueRaw([Protocol.ROOM_STATE_PATCH, ...this.state.encodeFiltered(client)]);
        }

        if (debugPatch.enabled) {
          debugPatch(
            'filterd patch sent to %d clients, %j',
            clients.length,
            (debugPatch as any).dumpChanges,
          );
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

  public hasFilter(schema: Definition, filters: any = {}, schemasCache?: WeakSet<Definition>) {
    let hasFilter = false;

    // set of schemas we already checked OR are still checking
    const knownSchemas = schemasCache || new WeakSet<Definition>();
    knownSchemas.add(schema);

    for (const fieldName of Object.keys(schema)) {
      // skip if a filter has been found
      if (hasFilter) { break; }

      if (filters[fieldName]) {
        hasFilter = true;

      } else if (typeof schema[fieldName] === 'function') {
        const childSchema = schema[fieldName]['_schema'];
        const childFilters = schema[fieldName]['_filters'];

        if (!knownSchemas.has(childSchema)) {
          hasFilter = this.hasFilter(childSchema, childFilters, knownSchemas);
        }

      } else if (Array.isArray(schema[fieldName])) {
        if (typeof schema[fieldName][0] === 'string') {
          continue;
        }
        const childSchema = schema[fieldName][0]['_schema'];
        const childFilters = schema[fieldName][0]['_filters'];

        if (!knownSchemas.has(childSchema)) {
          hasFilter = this.hasFilter(childSchema, childFilters, knownSchemas);
        }

      } else if ((schema[fieldName] as any).map) {
        if (typeof (schema[fieldName] as any).map === 'string') {
          continue;
        }
        const childSchema = (schema[fieldName] as any).map['_schema'];
        const childFilters = (schema[fieldName] as any).map['_filters'];

        if (!knownSchemas.has(childSchema)) {
          hasFilter = this.hasFilter(childSchema, childFilters, knownSchemas);
        }

      }
    }

    return hasFilter;
  }
}
