/* tslint:disable:no-string-literal */

import { Client } from '..';
import { Serializer } from './Serializer';

import { dumpChanges, hasFilter, Reflection, Schema } from '@colyseus/schema';
import { debugPatch } from '../Debug';
import { Protocol } from '../Protocol';

export class SchemaSerializer<T> implements Serializer<T> {
  public id = 'schema';

  private state: T & Schema;
  private useFilters: boolean = false;

  private handshakeCache: number[];

  public reset(newState: T & Schema) {
    this.state = newState;
    this.useFilters = hasFilter(newState.constructor as typeof Schema);
  }

  public getFullState(client?: Client) {
    const fullEncodedState = this.state.encodeAll();

    if (client && this.useFilters) {
      return this.state.applyFilters(fullEncodedState, client);

    } else {
      return fullEncodedState;
    }
  }

  public applyPatches(clients: Client[]) {
    const hasChanges = this.state['$changes'].changed;

    if (hasChanges) {
      let numClients = clients.length;

      // dump changes for patch debugging
      if (debugPatch.enabled) {
        (debugPatch as any).dumpChanges = dumpChanges(this.state);
      }

      // get patches
      const patches = this.state.encode();

      if (!this.useFilters) {
        // encode changes once, for all clients
        patches.unshift(Protocol.ROOM_STATE_PATCH);

        while (numClients--) {
          const client = clients[numClients];
          client.enqueueRaw(patches);
        }

      } else {

        // encode state multiple times, for each client
        while (numClients--) {
          const client = clients[numClients];
          const filteredPatches = this.state.applyFilters(patches, client);
          client.enqueueRaw([Protocol.ROOM_STATE_PATCH, ...filteredPatches]);
        }

        this.state.discardAllChanges();
      }

      // debug patches
      if (debugPatch.enabled) {
        debugPatch(
          '%d bytes sent to %d clients, %j',
          patches.length,
          clients.length,
          (debugPatch as any).dumpChanges,
        );
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

}
