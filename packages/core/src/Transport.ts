import * as http from 'http';
import * as https from 'https';

import type { Router } from '@colyseus/better-call';

import { ErrorCode } from '@colyseus/shared-types';
import { StateView } from '@colyseus/schema';
import type { InputDecoder } from '@colyseus/schema/input';

import { EventEmitter } from 'events';
import { debugAndPrintError } from './Debug.ts';
import { getBearerToken, spliceOne } from './utils/Utils.ts';
import { ServerError } from './errors/ServerError.ts';

import type { Room } from './Room.ts';

let _transport: Transport | undefined;
export function setTransport(transport: Transport) { _transport = transport; }
export function getTransport() { return _transport; }

export abstract class Transport {
    public protocol?: string;
    /** Self-signed cert SHA-256 hash (byte array), surfaced to clients in the
     *  matchmake response so a WebTransport client can pin it via
     *  `serverCertificateHashes`. Set by transports that generate their own cert
     *  (h3). Undefined for transports using a CA-trusted cert. */
    public fingerprint?: number[];
    public server?: http.Server | https.Server;

    public abstract listen(port?: number | string, hostname?: string, backlog?: number, listeningListener?: Function): this;
    public abstract shutdown(): void;

    public abstract simulateLatency(milliseconds: number): void;

    /**
     * Returns an Express-compatible application for HTTP route handling.
     * For uWebSockets transport, this uses the uwebsockets-express module.
     * This method is called lazily only when an express callback is provided in server options.
     */
    public getExpressApp?(): Promise<import('express').Application> | import('express').Application | undefined;

    /**
     * Binds a router to the transport.
     * Some transports may have a custom way to bind a router to the transport.
     * (uWebSocketsTransport)
     */
    public bindRouter?(router: Router): void;
}

/**
 * Intercepts an incoming WebSocket upgrade request, before the handshake.
 *
 * Return a `Response` to answer the request instead of upgrading it. Return
 * nothing to upgrade as usual. The handler may be async, and the handshake waits
 * for it to resolve.
 *
 * `context` is the same shape `onAuth()` receives, read-only here: mutating it
 * does not carry over to `onAuth()`.
 *
 * Not supported by `H3Transport`: WebTransport has no upgrade handshake.
 *
 * @example
 * ```typescript
 * new uWebSocketsTransport({
 *   beforeUpgrade: async (request, context) => {
 *     if (await isBanned(context.ip)) {
 *       return new Response(null, { status: 403 });
 *     }
 *   }
 * });
 * ```
 */
export type BeforeUpgradeHandler = (
  request: Request,
  context: Readonly<AuthContext>,
) => Response | void | Promise<Response | void>;

/**
 * Invokes a `beforeUpgrade` handler, resolving with the `Response` to send
 * instead of upgrading, or `undefined` to proceed with the upgrade.
 *
 * Every transport goes through here, so a handler written against one keeps
 * working on the others. Never rejects: uWebSockets.js aborts the process on an
 * upgrade handler that yields without responding, and on the other transports a
 * raw socket left behind leaks a connection.
 *
 * @internal
 */
export async function runBeforeUpgrade(
  handler: BeforeUpgradeHandler,
  url: string, // path, optionally including the query string
  context: AuthContext,
): Promise<Response | undefined> {
  let request: Request;

  try {
    const host = context.headers.get('host') || 'localhost';
    request = new Request(`http://${host}${url}`, { headers: context.headers });

  } catch (e: any) {
    // a `Host` header that isn't a valid authority fails to parse as a URL
    debugAndPrintError(e);
    return new Response(null, { status: 400 });
  }

  try {
    return (await handler(request, context)) ?? undefined;

  } catch (e: any) {
    debugAndPrintError(e);
    return new Response(null, { status: 500 });
  }
}

/** Headers as the transport has them: uWebSockets.js and Node give a plain record. */
type RawHeaders = Headers | Record<string, string | undefined>;

const readHeader = (headers: RawHeaders, name: string) =>
  (headers instanceof Headers) ? headers.get(name) : headers[name];

/**
 * Builds the context passed to `beforeUpgrade` and `onAuth`.
 *
 * Every transport goes through here, so the context is identical everywhere,
 * down to how the client address is resolved. `headers` is materialized on
 * first read: a connection nobody inspects pays nothing for the conversion.
 *
 * @internal
 */
export function createAuthContext(options: {
  headers: RawHeaders,
  token?: string | null,
  remoteAddress?: string,
  req?: any,
}): AuthContext {
  const source = options.headers;
  let headers: Headers | undefined;

  return {
    token: options.token ?? getBearerToken(readHeader(source, 'authorization')),
    ip: resolveClientIp(source, options.remoteAddress),
    req: options.req,
    get headers() {
      return headers ??= (source instanceof Headers)
        ? source
        : new Headers(source as Record<string, string>);
    },
  };
}

/**
 * A single address, resolved the same way on every transport: `x-forwarded-for`
 * carries the whole proxy chain, and only its first entry is the client.
 */
function resolveClientIp(headers: RawHeaders, remoteAddress?: string): string | undefined {
  // an empty header counts as absent
  const firstHop = (name: string) => readHeader(headers, name)?.split(',')[0].trim() || undefined;

  return (
    firstHop('x-real-ip') ??
    firstHop('x-forwarded-for') ??
    firstHop('x-client-ip') ??
    (remoteAddress || undefined)
  );
}

export type AuthContext = {
  token?: string,
  /** Undefined when no proxy header carries it and the transport has no peer address. */
  ip: string | undefined;
  headers: Headers,
  /** Only set on the HTTP matchmaking request, where it is the `Request` itself. */
  req?: any;
};

export interface ISendOptions {
  afterNextPatch?: boolean;
}

export const ClientState = {
  JOINING: 0,
  JOINED: 1,
  RECONNECTING: 2,
  RECONNECTED: 3,
  LEAVING: 4,
  CLOSED: 5
} as const;
export type ClientState = (typeof ClientState)[keyof typeof ClientState];

// Helper types to extract properties from the Client type parameter
type ExtractClientUserData<T> = T extends { userData: infer U } ? U : T;
type ExtractClientAuth<T> = T extends { auth: infer A } ? A : any;
type ExtractClientMessages<T> = T extends { messages: infer M } ? M : any;

// Helper type to make message required when the message type demands it
export type MessageArgs<M, Options> =
  unknown extends M ? [message?: M, options?: Options] :  // Handle 'any' type (backwards compatibility)
  [M] extends [never] ? [message?: M, options?: Options] :
  [M] extends [void] ? [message?: M, options?: Options] :
  [M] extends [undefined] ? [message?: M, options?: Options] :
  undefined extends M ? [message?: M, options?: Options] :
  [message: M, options?: Options];

/**
 * The client instance from the server-side is responsible for the transport layer between the server and the client.
 * It should not be confused with the Client from the client-side SDK, as they have completely different purposes!
 * You operate on client instances from `this.clients`, `Room#onJoin()`, `Room#onLeave()` and `Room#onMessage()`.
 *
 * - This is the raw WebSocket connection coming from the `ws` package. There are more methods available which aren't
 *  encouraged to use along with Colyseus.
 */
export interface Client<T extends { userData?: any, auth?: any, messages?: Record<string | number, any> } = any> {
  '~messages': ExtractClientMessages<T>;

  ref: EventEmitter;

  /**
   * Unique id per session.
   */
  sessionId: string;

  /**
   * Connection state
   */
  state: ClientState;

  /**
   * Optional: when using `@view()` decorator in your state properties, this will be the view instance for this client.
   */
  view?: StateView;

  /**
   * User-defined data can be attached to the Client instance through this variable.
   * - Can be used to store custom data about the client's connection. userData is not synchronized with the client,
   * and should be used only to keep player-specific with its connection.
   */
  userData?: ExtractClientUserData<T>;

  /**
   * auth data provided by your `onAuth`
   */
  auth?: ExtractClientAuth<T>;

  /**
   * Reconnection token used to re-join the room after onLeave + allowReconnection().
   *
   * IMPORTANT:
   *    This is not the full reconnection token the client provides for the server.
   *    The format provided by .reconnect() from the client-side must follow: "${roomId}:${reconnectionToken}"
   */
  reconnectionToken: string;

  // TODO: move these to ClientPrivate
  raw(data: Uint8Array | Buffer, options?: ISendOptions, cb?: (err?: Error) => void): void;
  enqueueRaw(data: Uint8Array | Buffer, options?: ISendOptions): void;

  /**
   * Send raw bytes over the transport's UNRELIABLE channel — no delivery,
   * ordering, or duplication guarantee. Used for `@unreliable` state patches.
   *
   * Absent on transports with no datagram channel (every WebSocket transport).
   * Its presence IS the capability check — callers feature-detect rather than
   * reading a separate flag, and skip clients that can't receive.
   */
  rawUnreliable?(data: Uint8Array | Buffer, options?: ISendOptions, cb?: (err?: Error) => void): void;

  /**
   * Send a type of message to the client. Messages are encoded with MsgPack and can hold any
   * JSON-serializable data structure.
   *
   * @param type String or Number identifier the client SDK will use to receive this message
   * @param message Message payload. (automatically encoded with msgpack.)
   * @param options
   */
  send<K extends keyof this['~messages']>(
    type: K,
    ...args: MessageArgs<this['~messages'][K], ISendOptions>
  ): void;

  /**
   * Send raw bytes to this specific client.
   *
   * @param type String or Number identifier the client SDK will use to receive this message
   * @param bytes Raw byte array payload
   * @param options
   */
  sendBytes(type: string | number, bytes: Buffer | Uint8Array, options?: ISendOptions): void;

  /**
   * Disconnect this client from the room.
   *
   * @param code Custom close code. Default value is 1000.
   * @param data
   * @see [Leave room](https://docs.colyseus.io/room#leave-room)
   */
  leave(code?: number, data?: string): void;

  /**
   * @deprecated Use .leave() instead.
   */
  close(code?: number, data?: string): void;

  /**
   * Triggers `onError` with specified code to the client-side.
   *
   * @param code
   * @param message
   */
  error(code: number, message?: string): void;
}

/**
 * Private properties of the Client instance.
 * Only accessible internally by the framework, should not be encouraged/auto-completed for the user.
 *
 * TODO: refactor this.
 * @private
 */
export interface ClientPrivate {
  readyState: number; // TODO: remove readyState on version 1.0.0. Use only "state" instead.
  _enqueuedMessages?: any[];
  _joinedAt: number; // "elapsedTime" when the client joined the room.

  /**
   * Used for rate limiting via maxMessagesPerSecond.
   */
  _numMessagesLastSecond?: number;
  _lastMessageTime?: number;

  /**
   * Per-client input Schema instance, allocated on join when the Room
   * declares `input`. Mutated in-place by {@link _inputDecoder} on each
   * incoming ROOM_INPUT_* packet.
   *
   * Typed loosely (`any`) so duplicate `@colyseus/schema` installs don't
   * trigger type-identity errors against user-defined input classes.
   */
  _input?: any;
  _inputDecoder?: InputDecoder;

  /**
   * Per-client buffer of cloned input snapshots, allocated on join when
   * `Room.inputOptions.bufferMaxSize > 0`. Populated on each decoded frame.
   */
  _inputBuffer?: import('./input/InputBuffer.ts').InputBufferImpl;

  /**
   * Cached per-client accessor returned by `room.input(sessionId)`. Built
   * once at join (when the Room called `defineInput()`), so the public API
   * call is a Map lookup + property read with no per-call allocation.
   */
  _inputAccessor?: import('./input/types.ts').InputAccessor;

  /**
   * Used for rate limiting ROOM_INPUT_* packets via maxInputsPerSecond,
   * independent of maxMessagesPerSecond.
   */
  _numInputsLastSecond?: number;
  _lastInputTime?: number;

  /**
   * `performance.now()` recorded when the most recent ROOM_INPUT_* packet
   * from this client was received. Receive-side diagnostic only — NOT on the
   * wire: the {@link ProtocolModifier.TIMED} state prefix acks the seq of the
   * last input CONSUMED into the state (the input buffer's `ackSeq`).
   *
   * `0` until the client has sent its first input.
   */
  _lastInputReceivedAt?: number;

  /**
   * Monotonic count of *reliable* inputs successfully received from this
   * client. Receive-time counter — it LEADS the state by inputs still
   * buffered; what the TIMED prefix acks is the CONSUMED seq (the input
   * buffer's `ackSeq`), not this. Stays at the default `0` until the client
   * sends its first reliable input.
   *
   * Only ROOM_INPUT_RELIABLE bumps this — unreliable's redundant-ring
   * pattern would double-count.
   */
  _receivedInputCount?: number;

  /**
   * Running baseline for the DELTA-CODED lag-comp stamp on ROOM_INPUT_RELIABLE
   * frames (the {@link ProtocolModifier.TIMED} prefix). Each frame carries only
   * the signed change from the previous stamp; this accumulates them back into
   * the absolute timeline value. Zeroed on (re)connect alongside the SDK's own
   * baseline so the first delta after a reset is absolute. `0` until allocated.
   */
  _reckonBaseline?: number;

  /**
   * @internal Per-client raw frames staged to ride out right AFTER this client's
   * next state patch — per-client `afterNextPatch` messages. Lazily allocated.
   * Pushed by {@link enqueueClientRaw} (the `afterNextPatch` path), flushed as
   * standalone frames after the patch by {@link Room._flushPendingClientFrames}.
   * Room-level `broadcast` `afterNextPatch` uses the Room's own queue instead, not
   * this buffer.
   */
  _pendingFrames?: Uint8Array[];

  /**
   * @internal Back-reference to the Room's "clients with staged frames" list,
   * shared by reference at join. {@link enqueueClientRaw} pushes the client here
   * on its first staged frame of a cycle, so the after-patch flush iterates just
   * those clients rather than scanning every client.
   */
  _pendingFrameClients?: Array<Client & ClientPrivate>;
}

/**
 * The framework-level send path shared by every transport's `enqueueRaw` — the
 * single source of truth so each transport implements only the wire-level `raw`.
 * Routes a raw frame by where it should go:
 *
 *  - `afterNextPatch` → stage onto the per-client {@link ClientPrivate._pendingFrames}
 *    buffer, sent as a standalone frame right AFTER the next state patch; a
 *    no-allocation push into a reused array. The client announces itself to the
 *    Room's {@link ClientPrivate._pendingFrameClients} list on its first staged
 *    frame of a cycle.
 *  - before JOIN → buffer in `_enqueuedMessages` until the JOIN_ROOM handshake flushes.
 *  - otherwise → send now via the transport's `raw`.
 *
 * @internal
 */
export function enqueueClientRaw(
  client: Client & ClientPrivate,
  data: Uint8Array | Buffer,
  options?: ISendOptions,
): void {
  if (options?.afterNextPatch) {
    let frames = client._pendingFrames;
    if (frames === undefined) { frames = client._pendingFrames = []; }
    if (frames.length === 0) { client._pendingFrameClients?.push(client); } // first frame this cycle
    frames.push(data);
    return;
  }
  if (client.state !== ClientState.JOINED) {
    // During `onJoin` / `onReconnect` the client can't register onMessage
    // handlers yet — buffer until JOIN_ROOM has been sent.
    client._enqueuedMessages?.push(data);
    return;
  }
  client.raw(data, options);
}

export class ClientArray<C extends Client = Client> extends Array<C> {
  /**
   * Secondary index for O(1) lookup by sessionId. Kept in sync by the
   * mutating methods overridden below. Direct index assignment
   * (`arr[i] = client`) and `arr.length = 0` bypass this index — use
   * `push` / `splice` / `delete` / `pop` / `shift` / `unshift` instead.
   */
  private _byId: Map<string, C> = new Map();

  /** The client for `sessionId`, or `undefined` — O(1). The canonical per-session
   *  lookup (mirrors `room.inputs.get(sessionId)`). */
  public get(sessionId: string): C | undefined {
    return this._byId.get(sessionId);
  }

  /** @deprecated Use {@link get}. */
  public getById(sessionId: string): C | undefined {
    return this._byId.get(sessionId);
  }

  public delete(client: C): boolean {
    const removed = spliceOne(this, this.indexOf(client));
    if (removed) this._byId.delete(client.sessionId);
    return removed;
  }

  public push(...items: C[]): number {
    for (let i = 0; i < items.length; i++) this._byId.set(items[i].sessionId, items[i]);
    return super.push(...items);
  }

  public pop(): C | undefined {
    const removed = super.pop();
    if (removed !== undefined) this._byId.delete(removed.sessionId);
    return removed;
  }

  public shift(): C | undefined {
    const removed = super.shift();
    if (removed !== undefined) this._byId.delete(removed.sessionId);
    return removed;
  }

  public unshift(...items: C[]): number {
    for (let i = 0; i < items.length; i++) this._byId.set(items[i].sessionId, items[i]);
    return super.unshift(...items);
  }

  public splice(start: number, deleteCount?: number, ...items: C[]): C[] {
    const removed = (deleteCount === undefined)
      ? super.splice(start)
      : super.splice(start, deleteCount, ...items);
    for (let i = 0; i < removed.length; i++) this._byId.delete(removed[i].sessionId);
    for (let i = 0; i < items.length; i++) this._byId.set(items[i].sessionId, items[i]);
    return removed;
  }
}

/**
 * Shared internal method to connect a Client into a Room.
 * Validates seat reservation and joins the client to the room.
 *
 * @remarks
 * **⚠️ This is an internal API and not intended for end-user use.**
 *
 * @internal
 */
export async function connectClientToRoom(
  room: Room | undefined,
  client: Client & ClientPrivate,
  authContext: AuthContext,
  connectionOptions: {
    reconnectionToken?: string;
    skipHandshake?: boolean;
  },
): Promise<void> {
  if (!room || !room.hasReservedSeat(client.sessionId, connectionOptions.reconnectionToken)) {
    throw new ServerError(ErrorCode.MATCHMAKE_EXPIRED, 'seat reservation expired.');
  }

  await room['_onJoin'](client, authContext, connectionOptions);
}