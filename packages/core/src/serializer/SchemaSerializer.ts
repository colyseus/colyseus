import { Serializer } from './Serializer';

import { Encoder, dumpChanges, Reflection, Schema, Iterator, StateView } from '@colyseus/schema';
import { debugPatch } from '../Debug';
import { Protocol } from '../Protocol';
import { Client, ClientState } from '../Transport';

const SHARED_VIEW = {};

export class SchemaSerializer<T> implements Serializer<T> {
  public id = 'schema';

  private encoder: Encoder;
  private hasFilters: boolean = false;

  private handshakeCache: Buffer;

  // flag to avoid re-encoding full state if no changes were made
  private needFullEncode: boolean = true;

  // TODO: make this optional. allocating a new buffer for each room may not be always necessary.
  private fullEncodeCache: Buffer;
  private sharedOffsetCache: Iterator = { offset: 0 };

  private views: WeakMap<StateView | typeof SHARED_VIEW, Buffer> = new WeakMap();

  public reset(newState: T & Schema) {
    this.encoder = new Encoder(newState);
    this.fullEncodeCache = Buffer.allocUnsafe(Encoder.BUFFER_SIZE);

    this.hasFilters = this.encoder.context.hasFilters;

    if (this.hasFilters) {
      this.views = new WeakMap();
    }
  }

  public getFullState(client?: Client) {
    if (this.needFullEncode) {
      // cache ROOM_STATE byte as part of the encoded buffer
      this.sharedOffsetCache = { offset: 1 };
      this.fullEncodeCache[0] = Protocol.ROOM_STATE;
      this.fullEncodeCache = this.encoder.encodeAll(this.sharedOffsetCache, this.fullEncodeCache);
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
    let numClients = clients.length;
    this.needFullEncode = (this.encoder.root.changes.size > 0);

    if (
      numClients == 0 ||
      (
        !this.needFullEncode &&
        (!this.hasFilters || this.encoder.root.filteredChanges.size === 0)
      )
    ) {
      return false;
    }


    // dump changes for patch debugging
    if (debugPatch.enabled) {
      (debugPatch as any).dumpChanges = dumpChanges(this.encoder.state);
    }

    // get patch bytes
    const it: Iterator = { offset: 1 };
    this.encoder.sharedBuffer[0] = Protocol.ROOM_STATE_PATCH;

    // encode changes once, for all clients
    const encodedChanges = this.encoder.encode(it);

    if (!this.hasFilters) {
      while (numClients--) {
        const client = clients[numClients];

        //
        // FIXME: avoid this check for each client
        //
        if (client.state !== ClientState.JOINED) {
          continue;
        }

        client.raw(encodedChanges);
      }

    } else {
      // cache shared offset
      const sharedOffset = it.offset;

      // encode state multiple times, for each client
      while (numClients--) {
        const client = clients[numClients];

        //
        // FIXME: avoid this check for each client
        //
        if (client.state !== ClientState.JOINED) {
          continue;
        }

        const view = client.view || SHARED_VIEW;

        let encodedView = this.views.get(view);

        if (encodedView === undefined) {
          encodedView = (view === SHARED_VIEW)
            ? encodedChanges
            : this.encoder.encodeView(client.view, sharedOffset, it);
          this.views.set(view, encodedView);
        }

        client.raw(encodedView);
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
      // TODO: re-use handshake buffer for all rooms
      this.handshakeCache = (this.encoder.state && Reflection.encode(this.encoder.state));
    }

    return this.handshakeCache;
  }

}
