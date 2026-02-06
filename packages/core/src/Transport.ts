import * as http from 'http';
import * as https from 'https';

import type { Router } from '@colyseus/better-call';

import { ErrorCode } from '@colyseus/shared-types';
import { StateView } from '@colyseus/schema';

import { EventEmitter } from 'events';
import { spliceOne } from './utils/Utils.ts';
import { ServerError } from './errors/ServerError.ts';

import type { Room } from './Room.ts';

let _transport: Transport | undefined;
export function setTransport(transport: Transport) { _transport = transport; }
export function getTransport() { return _transport; }

export abstract class Transport {
    public protocol?: string;
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
   * @deprecated use `sessionId` instead.
   */
  id: string;

  /**
   * Unique id per session.
   */
  sessionId: string; // TODO: remove sessionId on version 1.0.0

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
  _afterNextPatchQueue: Array<[string | number | Client, ArrayLike<any>]>;
  _joinedAt: number; // "elapsedTime" when the client joined the room.

  /**
   * Used for rate limiting via maxMessagesPerSecond.
   */
  _numMessagesLastSecond?: number;
  _lastMessageTime?: number;
}

export class ClientArray<C extends Client = Client> extends Array<C> {
  public getById(sessionId: string): C | undefined {
    return this.find((client) => client.sessionId === sessionId);
  }

  public delete(client: C): boolean {
    return spliceOne(this, this.indexOf(client));
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