import { Protocol } from '@colyseus/shared-types';

import type { Serializer } from './Serializer.ts';
import { type Client, ClientState } from '../Transport.ts';

import { type Iterator, Encoder, dumpChanges, Reflection, Schema, StateView } from '@colyseus/schema';
import { debugPatch } from '../Debug.ts';

const SHARED_VIEW = {};

export class SchemaSerializer<T extends Schema> implements Serializer<T> {
  public id = 'schema';

  protected encoder: Encoder<T>;
  protected hasFilters: boolean = false;

  protected handshakeCache: Uint8Array;

  // flag to avoid re-encoding full state if no changes were made
  protected needFullEncode: boolean = true;

  // TODO: make this optional. allocating a new buffer for each room may not be always necessary.
  protected fullEncodeBuffer: Uint8Array = new Uint8Array(Encoder.BUFFER_SIZE);
  protected fullEncodeCache: Uint8Array;
  protected sharedOffsetCache: Iterator = { offset: 0 };

  protected encodedViews: Map<StateView | typeof SHARED_VIEW, Uint8Array>;

  public reset(newState: T & Schema) {
    this.encoder = new Encoder(newState);
    this.hasFilters = this.encoder.context.hasFilters;

    // cache ROOM_STATE byte as part of the encoded buffer
    this.fullEncodeBuffer[0] = Protocol.ROOM_STATE;

    if (this.hasFilters) {
      this.encodedViews = new Map();
    }
  }

  public getFullState(client?: Client) {
    if (this.needFullEncode || this.encoder.root.changes.next !== undefined) {
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

    if (numClients === 0) {
      // skip patching and clear changes
      this.encoder.discardChanges();
      return false;
    }

    if (!this.encoder.hasChanges) {

      // check if views have changes (manual add() or remove() items)
      if (this.hasFilters) {
        //
        // FIXME: refactor this to avoid duplicating code.
        //
        // it's probably better to have 2 different 'applyPatches' methods.
        // (one for handling state with filters, and another for handling state without filters)
        //
        const clientsWithViewChange = clients.filter((client) => {
          return client.state === ClientState.JOINED && client.view?.changes.size > 0
        });

        if (clientsWithViewChange.length > 0) {
          const it: Iterator = { offset: 1 };

          const sharedOffset = it.offset;
          this.encoder.sharedBuffer[0] = Protocol.ROOM_STATE_PATCH;

          clientsWithViewChange.forEach((client) => {
            client.raw(this.encoder.encodeView(client.view, sharedOffset, it));
          });
        }
      }

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

        let encodedView = this.encodedViews.get(view);

        // allow to pass the same encoded view for multiple clients
        if (encodedView === undefined) {
          encodedView = (view === SHARED_VIEW)
            ? encodedChanges
            : this.encoder.encodeView(client.view, sharedOffset, it);
          this.encodedViews.set(view, encodedView);
        }

        client.raw(encodedView);
      }

      // clear views
      this.encodedViews.clear();
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
