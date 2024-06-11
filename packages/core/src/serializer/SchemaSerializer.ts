import { Serializer } from './Serializer';

import { Encoder, dumpChanges, Reflection, Schema, $changes, Iterator, StateView } from '@colyseus/schema';
import { debugPatch } from '../Debug';
import { Protocol } from '../Protocol';
import { Client } from '../Transport';

const STATE_PATCH_BUFFER = Buffer.from([Protocol.ROOM_STATE_PATCH]);
const SHARED_VIEW = {};

export class SchemaSerializer<T> implements Serializer<T> {
  public id = 'schema';

  private encoder: Encoder;
  private hasFilters: boolean = false;

  private handshakeCache: Buffer;

  private fullEncodeCache: Buffer;
  private sharedOffsetCache: Iterator = { offset: 0 };

  private views: WeakMap<StateView | typeof SHARED_VIEW, Buffer> = new WeakMap();

  // flag to avoid re-encoding full state if no changes were made
  private needFullEncode: boolean = true;

  public reset(newState: T & Schema) {
    this.encoder = new Encoder(newState);
    this.hasFilters = this.encoder.context.hasFilters;

    if (this.hasFilters) {
      this.views = new WeakMap();
    }
  }

  public getFullState(client?: Client) {
    if (this.needFullEncode) {
      this.sharedOffsetCache = { offset: 0 };
      this.fullEncodeCache = this.encoder.encodeAll(this.sharedOffsetCache);
      this.needFullEncode = false;
    }

    if (this.hasFilters && client?.view) {
      return this.encoder.encodeAllView(
        client.view,
        this.sharedOffsetCache.offset,
        { ...this.sharedOffsetCache },
        this.fullEncodeCache
      );

    } else {
      return this.fullEncodeCache;
    }
  }

  public applyPatches(clients: Client[]) {
    this.needFullEncode = (this.encoder.$root.changes.size > 0);

    if (
      !this.needFullEncode &&
      (!this.hasFilters || this.encoder.$root.filteredChanges.size === 0)
    ) {
      return false;
    }

    let numClients = clients.length;

    // dump changes for patch debugging
    if (debugPatch.enabled) {
      (debugPatch as any).dumpChanges = dumpChanges(this.encoder.state);
    }

    // get patch bytes
    const it: Iterator = { offset: 0 };
    const encodedChanges = this.encoder.encode(it);

    if (!this.hasFilters) {
      // encode changes once, for all clients
      const sharedChanges = Buffer.concat([STATE_PATCH_BUFFER, encodedChanges]);

      while (numClients--) {
        clients[numClients].raw(sharedChanges);
      }

    } else {
      // cache shared offset
      const sharedOffset = it.offset;

      // encode state multiple times, for each client
      while (numClients--) {
        const client = clients[numClients];
        const view = client.view || SHARED_VIEW;

        let encodedView = this.views.get(view);
        if (encodedView === undefined) {
          encodedView = (view === SHARED_VIEW)
            ? Buffer.concat([STATE_PATCH_BUFFER, encodedChanges])
            : this.encoder.encodeView(client.view, sharedOffset, it);
          this.views.set(view, encodedView);
        }

        client.raw(Buffer.concat([STATE_PATCH_BUFFER, encodedView]));
      }
    }

    // discard changes after sending
    this.encoder.discardChanges();

    // debug patches
    if (debugPatch.enabled) {
      debugPatch(
        '%d bytes sent to %d clients, %j',
        encodedChanges.length,
        clients.length,
        (debugPatch as any).dumpChanges,
      );
    }

    return true;
  }

  public handshake() {
    /**
     * Cache handshake to avoid encoding it for each client joining
     */
    if (!this.handshakeCache) {
      this.handshakeCache = (this.encoder.state && Reflection.encode(this.encoder.state));
    }

    return this.handshakeCache;
  }

}
