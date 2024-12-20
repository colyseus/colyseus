import { Serializer } from './Serializer.js';

import { Encoder, dumpChanges, Reflection, Schema, Iterator, StateView } from '@colyseus/schema';
import { debugPatch } from '../Debug.js';
import { Protocol } from '../Protocol.js';
import { Client, ClientState } from '../Transport.js';

const SHARED_VIEW = {};

export class SchemaSerializer<T extends Schema> implements Serializer<T> {
  public id = 'schema';

  protected encoder: Encoder<T>;
  protected hasFilters: boolean = false;

  protected handshakeCache: Buffer;

  // flag to avoid re-encoding full state if no changes were made
  protected needFullEncode: boolean = true;

  // TODO: make this optional. allocating a new buffer for each room may not be always necessary.
  protected fullEncodeBuffer: Buffer = Buffer.allocUnsafe(Encoder.BUFFER_SIZE);
  protected fullEncodeCache: Buffer;
  protected sharedOffsetCache: Iterator = { offset: 0 };

  protected views: Map<StateView | typeof SHARED_VIEW, Buffer>;

  public reset(newState: T & Schema) {
    this.encoder = new Encoder(newState);
    this.hasFilters = this.encoder.context.hasFilters;

    // cache ROOM_STATE byte as part of the encoded buffer
    this.fullEncodeBuffer[0] = Protocol.ROOM_STATE;

    if (this.hasFilters) {
      this.views = new Map();
    }
  }

  public getFullState(client?: Client) {
    if (this.needFullEncode || this.encoder.root.changes.length > 0) {
      this.sharedOffsetCache = { offset: 1 };
      this.fullEncodeCache = this.encoder.encodeAll(this.sharedOffsetCache, this.fullEncodeBuffer);
      this.needFullEncode = false;
    }

    if (this.hasFilters && client?.view) {
      return this.encoder.encodeAllView(
        client.view,
        this.sharedOffsetCache.offset,
        { ...this.sharedOffsetCache },
        this.fullEncodeBuffer
      );

    } else {
      return this.fullEncodeCache;
    }
  }

  public applyPatches(clients: Client[]) {
    let numClients = clients.length;

    if (numClients == 0 || !this.encoder.hasChanges) {
      // skip patching state if:
      // - no clients are connected
      // - no changes were made
      // - no "filtered changes" were made when using filters
      return false;
    }

    this.needFullEncode = true;

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

        // allow to pass the same encoded view for multiple clients
        if (encodedView === undefined) {
          encodedView = (view === SHARED_VIEW)
            ? encodedChanges
            : this.encoder.encodeView(client.view, sharedOffset, it);
          this.views.set(view, encodedView);
        }

        client.raw(encodedView);
      }

      // clear views
      this.views.clear();
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
      //
      // TODO: re-use handshake buffer for all rooms of same type (?)
      //
      this.handshakeCache = (this.encoder.state && Reflection.encode(this.encoder));
    }

    return this.handshakeCache;
  }

}
