import { Protocol, ProtocolModifier } from '@colyseus/shared-types';

import type { PatchTimingContext, Serializer } from './Serializer.ts';
import { type Client, type ClientPrivate, ClientState } from '../Transport.ts';

import { type Iterator, encode, Encoder, dumpChanges, Reflection, Schema, StateView } from '@colyseus/schema';
import { debugPatch } from '../Debug.ts';

/**
 * Size of the {@link ProtocolModifier.TIMED} prefix that follows the
 * protocol byte:
 *   `[uint32 sNow][uint32 inputSeq]`
 *
 *   - `sNow`     — server clock as **milliseconds since room start**
 *     (`room.clock.elapsedTime`), NOT raw `performance.now()`. A portable,
 *     language-agnostic integer (C/C#/Lua have no `performance.now()`); the
 *     server's own time-keyed logic uses the SAME `clock.elapsedTime` so the
 *     client's reconstructed `serverNow()` stays in phase. Wraps at u32
 *     (~49.7 days uptime) — irrelevant per session. Drives the client clock
 *     offset / `serverNow()`.
 *   - `inputSeq` — seq VALUE of the last input CONSUMED into the authoritative
 *     state (the input buffer's `ackSeq`, i.e. last-PROCESSED input). Reliable:
 *     equals the consumed count (inputs are sequenced implicitly by receive
 *     order). Unreliable: the framework wire seq, so a fully-dropped input
 *     doesn't make the ack lag the client's sent seq by the lost count. This
 *     single number is the canonical reconciliation ack ("the sequence number
 *     of the last input the server processed"); the client prunes its
 *     pending-input buffer against it AND derives RTT from its round-trip
 *     (`now − sendTime(inputSeq)`). No separate received-seq / received-time —
 *     RTT-from-the-processed-ack is round-trip-inclusive, which is the standard.
 */
const TIMED_PREFIX_SIZE = 8;

/**
 * Construct a per-recipient TIMED buffer:
 *   `[code|TIMED][sNow][inputSeq][...schema bytes]`
 *
 * `encodedBody` is the shared encoded buffer whose byte 0 already holds the
 * base protocol code (ROOM_STATE or ROOM_STATE_PATCH); bytes 1.. are the
 * schema payload. We construct a fresh per-client Buffer so the transport
 * never sees a buffer that might mutate between queue and send.
 *
 * Uses the schema `encode.*` helpers to keep the wire layout symmetric with
 * the SDK's `decode.*`-driven reader.
 */
function buildTimedFrame(
  encodedBody: Uint8Array,
  sNow: number,
  inputSeq: number,
): Buffer {
  const schemaPayload = encodedBody.subarray(1);
  const out = Buffer.allocUnsafe(1 + TIMED_PREFIX_SIZE + schemaPayload.length);
  out[0] = encodedBody[0] | ProtocolModifier.TIMED;
  const it: Iterator = { offset: 1 };
  encode.uint32(out, sNow >>> 0, it); // ms since room start (clock.elapsedTime)
  encode.uint32(out, inputSeq >>> 0, it);
  out.set(schemaPayload, it.offset);
  return out;
}

/** Seq VALUE of the last input consumed from the client's buffer — the
 *  reconciliation ack (and RTT correlation key). Reliable: equals the consumed
 *  count; unreliable: the framework wire seq (so packet loss doesn't skew it).
 *  0 when the room doesn't buffer input. */
function clientProcessedInputSeq(client: Client): number {
  return (client as Client & ClientPrivate)._inputBuffer?.ackSeq ?? 0;
}

/**
 * Send a per-recipient patch frame: a TIMED-prefixed buffer when `timing` is set,
 * else the shared `encodedBody` passed straight through (no per-client copy). Any
 * `afterNextPatch` frames staged on `client._pendingFrames` are NOT coalesced here
 * — they go out standalone right after the patch via `Room._flushPendingClientFrames`.
 */
function sendClientFrame(client: Client, encodedBody: Uint8Array, timing?: PatchTimingContext): void {
  if (timing) {
    client.raw(buildTimedFrame(encodedBody, timing.sNow, clientProcessedInputSeq(client)));
  } else {
    client.raw(encodedBody);
  }
}

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

  public getFullState(client?: Client, timing?: PatchTimingContext) {
    if (this.needFullEncode || this.encoder.root.changes.next !== undefined) {
      this.sharedOffsetCache = { offset: 1 };
      this.fullEncodeCache = this.encoder.encodeAll(this.sharedOffsetCache, this.fullEncodeBuffer);
      this.needFullEncode = false;
    }

    const body = (this.hasFilters && client?.view)
      ? this.encoder.encodeAllView(
          client.view,
          this.sharedOffsetCache.offset,
          { ...this.sharedOffsetCache },
          this.fullEncodeBuffer
        )
      : this.fullEncodeCache;

    if (timing && client) {
      return buildTimedFrame(body, timing.sNow, clientProcessedInputSeq(client));
    }
    return body;
  }

  public applyPatches(clients: Client[], _state?: unknown, timing?: PatchTimingContext) {
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
          return client.state === ClientState.JOINED && client.view?.changes.size > 0
        });

        if (clientsWithViewChange.length > 0) {
          const it: Iterator = { offset: 1 };

          const sharedOffset = it.offset;
          this.encoder.sharedBuffer[0] = Protocol.ROOM_STATE_PATCH;

          clientsWithViewChange.forEach((client) => {
            const encodedView = this.encoder.encodeView(client.view, sharedOffset, it);
            sendClientFrame(client, encodedView, timing);
          });
        }
      }

      // Heartbeat: `defineInput()` rooms still need periodic timing samples
      // to keep client clock offset / RTT estimates fresh during quiet
      // ticks. Emit a TIMED-prefixed ROOM_STATE_PATCH with an empty schema
      // body — 1 byte protocol + 8 bytes prefix.
      // No-op for rooms without `defineInput()` (timing is undefined).
      if (timing) {
        const heartbeatBody = Buffer.from([Protocol.ROOM_STATE_PATCH]);
        for (let i = 0; i < clients.length; i++) {
          const client = clients[i];
          if (client.state !== ClientState.JOINED) continue;
          sendClientFrame(client, heartbeatBody, timing);
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

        sendClientFrame(client, encodedChanges, timing);
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

        sendClientFrame(client, encodedView, timing);
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
