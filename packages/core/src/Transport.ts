import * as http from 'http';
import * as https from 'https';

import type { Router } from '@colyseus/better-call';

import { ErrorCode } from '@colyseus/shared-types';
import { StateView } from '@colyseus/schema';
import type { InputDecoder } from '@colyseus/schema/input';

import { EventEmitter } from 'events';
import { spliceOne } from './utils/Utils.ts';
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

export type AuthContext = {
  token?: string,
  headers: Headers,
  ip: string | string[];
  // FIXME: each transport may have its own specific properties.
  // "req" only applies to WebSocketTransport.
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
  _inputAccessor?: import('./input/InputBuffer.ts').InputAccessor;

  /**
   * Used for rate limiting ROOM_INPUT_* packets via maxInputsPerSecond,
   * independent of maxMessagesPerSecond.
   */
  _numInputsLastSecond?: number;
  _lastInputTime?: number;

  /**
   * `performance.now()` recorded when the most recent ROOM_INPUT_* packet
   * from this client was received. Drives the per-recipient `lastTReceived`
   * field of the {@link ProtocolModifier.TIMED} state prefix.
   *
   * `0` until the client has sent its first input.
   */
  _lastInputReceivedAt?: number;

  /**
   * Monotonic count of *reliable* inputs successfully received from this
   * client. Echoed back in the TIMED prefix as `lastInputSeq` so the
   * client can correlate to its own send-time table and compute RTT.
   * Stays at the default `0` until the client sends its first reliable
   * input.
   *
   * Only ROOM_INPUT_RELIABLE bumps this — unreliable's redundant-ring
   * pattern would double-count.
   */
  _receivedInputCount?: number;

  /**
   * @internal High-water mark of the highest in-frame actionId dispatched for this
   * client — the dup/reorder guard. Action ids are client-monotonic, so an
   * unreliable redelivery (UDP dup) or a reordered older frame carries an id at or
   * below this and is dropped, mirroring the input ring's monotonic seq dedup.
   */
  _lastActionId?: number;

  /**
   * @internal Per-client raw frames staged to ride INTO this client's next
   * state patch — in-frame `predict.action` verdicts + per-client
   * `afterNextPatch` messages (brief 21, Design B). Lazily allocated. Pushed by
   * {@link enqueueClientRaw} (the `afterNextPatch` path), drained by the
   * serializer when it builds the client's patch frame — or flushed as standalone
   * frames if no patch carries them this tick. Room-level `broadcast`
   * `afterNextPatch` uses the Room's own queue instead, not this buffer.
   */
  _pendingFrames?: Uint8Array[];
}

/**
 * The framework-level send path shared by every transport's `enqueueRaw` — the
 * single source of truth so each transport implements only the wire-level `raw`.
 * Routes a raw frame by where it should go:
 *
 *  - `afterNextPatch` → stage onto the per-client {@link ClientPrivate._pendingFrames}
 *    buffer, ridden INTO the next state patch (brief 21); a no-allocation push into a
 *    reused array.
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
    (client._pendingFrames ??= []).push(data);
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