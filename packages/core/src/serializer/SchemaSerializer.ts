import {
  dumpChanges,
  Encoder,
  type Iterator,
  Reflection,
  type Schema,
  type StateView,
} from '@colyseus/schema';
import { Protocol } from '@colyseus/shared-types';
import { debugPatch } from '../Debug.ts';
import { type Client, ClientState } from '../Transport.ts';
import type { Serializer } from './Serializer.ts';

const SHARED_VIEW = {};
const SWITCH_TO_STRUCTURE = 255;
const ROOT_REF_ID = 0;
const EMPTY_BYTES = new Uint8Array();
const SWITCH_TO_ROOT = new Uint8Array([SWITCH_TO_STRUCTURE, ROOT_REF_ID]);

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
      const sharedOffset = this.sharedOffsetCache.offset;
      const fullViewBytes = this.encoder.encodeAllView(
        client.view,
        sharedOffset,
        { ...this.sharedOffsetCache },
        this.fullEncodeBuffer,
      );

      //
      // If the client's StateView has any pending `view.changes` entries —
      // typically structural ADD ops seeded by `view.add()` calls before the
      // client has synced (e.g. a late joiner whose AOI tracker just tagged
      // pre-existing entities) — encode those FIRST so their refIds are
      // introduced on the wire before the cached `encodeAll` baseline
      // references them. Without this reordering, baseline ops emitted in
      // earlier `encodeAll` runs (whose introducing ADDs are no longer in
      // `root.allChanges`) reference refIds the new client's decoder never
      // registered, producing "refId not found" errors.
      //
      // See: https://github.com/colyseus/colyseus/issues/935
      //
      if (client.view.changes.size === 0) {
        return fullViewBytes;
      }

      const viewChangesBytes = this.encoder.encodeView(
        client.view,
        sharedOffset,
        { ...this.sharedOffsetCache },
        this.fullEncodeBuffer,
      );

      // Layout: [protocol byte][view introductions][switch root][encodeAll baseline][per-view filtered ops]
      const PROTOCOL_PREFIX_LEN = 1;
      const protocolByte = fullViewBytes.subarray(0, PROTOCOL_PREFIX_LEN);
      const baselineBody = fullViewBytes.subarray(PROTOCOL_PREFIX_LEN, sharedOffset);
      const introductions = viewChangesBytes.subarray(sharedOffset);
      const fullViewBody = fullViewBytes.subarray(sharedOffset);
      const switchToRoot = baselineBody.length > 0 ? SWITCH_TO_ROOT : EMPTY_BYTES;

      const out = new Uint8Array(
        protocolByte.length +
          introductions.length +
          switchToRoot.length +
          baselineBody.length +
          fullViewBody.length,
      );
      let offset = 0;
      out.set(protocolByte, offset);
      offset += protocolByte.length;
      out.set(introductions, offset);
      offset += introductions.length;
      out.set(switchToRoot, offset);
      offset += switchToRoot.length;
      out.set(baselineBody, offset);
      offset += baselineBody.length;
      out.set(fullViewBody, offset);
      return out;
    } else {
      return this.fullEncodeCache;
    }
  }

  public applyPatches(clients: Client[]) {
    let numClients = clients.length;

    if (numClients === 0) {
      if (this.encoder.hasChanges) {
        // if there are changes but no clients, we need to encode full state on next patch
        this.needFullEncode = true;
      }
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
          return client.state === ClientState.JOINED && client.view?.changes.size > 0;
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
          encodedView =
            view === SHARED_VIEW
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
      this.handshakeCache = this.encoder.state && Reflection.encode(this.encoder);
    }

    return this.handshakeCache;
  }
}
