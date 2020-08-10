/* tslint:disable:no-string-literal */

import { Client } from '..';
import { Serializer } from './Serializer';

import { dumpChanges, hasFilter, Reflection, Schema } from '@colyseus/schema';
import { debugPatch } from '../Debug';
import { Protocol } from '../Protocol';
import { ClientState } from '../transport/Transport';

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
    const fullEncodedState = this.state.encodeAll(this.useFilters);

    if (client && this.useFilters) {
      return this.state.applyFilters(client, true);

    } else {
      return fullEncodedState;
    }
  }

  public applyPatches(clients: Client[]) {
    const hasChanges = this.state['$changes'].changes.size > 0;

    if (hasChanges) {
      let numClients = clients.length;

      // dump changes for patch debugging
      if (debugPatch.enabled) {
        (debugPatch as any).dumpChanges = dumpChanges(this.state);
      }

      // get patch bytes
      const patches = this.state.encode(false, [], this.useFilters);

      if (!this.useFilters) {
        // encode changes once, for all clients
        patches.unshift(Protocol.ROOM_STATE_PATCH);

        while (numClients--) {
          const client = clients[numClients];

          //
          // FIXME: avoid this check.
          //
          if (client.state === ClientState.JOINED) {
            client.raw(patches);
          }
        }

      } else {

        // encode state multiple times, for each client
        while (numClients--) {
          const client = clients[numClients];

          //
          // FIXME: avoid this check.
          //
          if (client.state === ClientState.JOINED) {
            const filteredPatches = this.state.applyFilters(client);
            client.raw([Protocol.ROOM_STATE_PATCH, ...filteredPatches]);
          }
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
