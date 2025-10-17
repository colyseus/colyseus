import * as http from 'http';
import * as https from 'https';
import * as net from 'net';

import { StateView } from '@colyseus/schema';
import { EventEmitter } from 'events';
import { spliceOne } from './utils/Utils.ts';

export abstract class Transport {
    public protocol?: string;
    public server?: net.Server | http.Server | https.Server;

    public abstract listen(port?: number, hostname?: string, backlog?: number, listeningListener?: Function): this;
    public abstract shutdown(): void;

    public abstract simulateLatency(milliseconds: number): void;
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

export const ClientState = { JOINING: 0, JOINED: 1, RECONNECTED: 2, LEAVING: 3, CLOSED: 4 } as const;
export type ClientState = (typeof ClientState)[keyof typeof ClientState];

export interface DefineClient<T extends {
  userData?: any,
  auth?: any,
  messages: Record<string | number, any>
}> extends Client<T['userData'], T['auth'], T['messages']> { }

/**
 * The client instance from the server-side is responsible for the transport layer between the server and the client.
 * It should not be confused with the Client from the client-side SDK, as they have completely different purposes!
 * You operate on client instances from `this.clients`, `Room#onJoin()`, `Room#onLeave()` and `Room#onMessage()`.
 *
 * - This is the raw WebSocket connection coming from the `ws` package. There are more methods available which aren't
 *  encouraged to use along with Colyseus.
 */
export interface Client<UserData = any, AuthData = any, MessageTypes extends Record<string | number, any> = any> { // Record<string | number, any>
  '~messages': MessageTypes;

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
  userData?: UserData;

  /**
   * auth data provided by your `onAuth`
   */
  auth?: AuthData;

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
  send<T extends keyof MessageTypes>(type: T, message?: MessageTypes[T], options?: ISendOptions): void;
  send(type: string | number, message?: any, options?: ISendOptions): void;

  /**
   * Send raw bytes to this specific client.
   *
   * @param type String or Number identifier the client SDK will use to receive this message
   * @param bytes Raw byte array payload
   * @param options
   */
  sendBytes<T extends keyof MessageTypes>(type: T, bytes: Buffer | Uint8Array, options?: ISendOptions): void;
  sendBytes(type: string | number, bytes: Buffer | Uint8Array, options?: ISendOptions): void;

  /**
   * Disconnect this client from the room.
   *
   * @param code Custom close code. Default value is 1000.
   * @param data
   * @see {@link https://docs.colyseus.io/colyseus/server/room/#leavecode-number}
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
  _afterNextPatchQueue: Array<[string | Client, IArguments]>;
  _joinedAt: number; // "elapsedTime" when the client joined the room.
}

export class ClientArray<C extends Client = Client> extends Array<C> {
  public getById(sessionId: string): C | undefined {
    return this.find((client) => client.sessionId === sessionId);
  }

  public delete(client: C): boolean {
    return spliceOne(this, this.indexOf(client));
  }
}