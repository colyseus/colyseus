import * as http from 'http';
import * as https from 'https';
import * as net from 'net';

import { Schema } from '@colyseus/schema';
import { EventEmitter } from 'events';
import { DummyServer } from "./utils/Utils";

export abstract class Transport {
    public server?: net.Server | http.Server | https.Server | DummyServer;

    public abstract listen(port?: number, hostname?: string, backlog?: number, listeningListener?: Function): this;
    public abstract shutdown(): void;

    public abstract simulateLatency(milliseconds: number): void;
}

export interface ISendOptions {
  afterNextPatch?: boolean;
}

export enum ClientState { JOINING, JOINED, RECONNECTED, LEAVING }

export interface Client {
  readyState: number;

  id: string;
  sessionId: string; // TODO: remove sessionId on version 1.0.0
  state: ClientState;

  ref: EventEmitter;

  upgradeReq?: http.IncomingMessage; // cross-compatibility for ws (v3.x+) and uws

  /**
   * User-defined data can be attached to the Client instance through this variable.
   */
  userData?: any;

  /**
   * auth data provided by your `onAuth`
   */
  auth?: any;
  pingCount?: number; // ping / pong

  _reconnectionToken: string;
  _enqueuedMessages?: any[];
  _afterNextPatchQueue: Array<[string | Client, IArguments]>;

  raw(data: ArrayLike<number>, options?: ISendOptions, cb?: (err?: Error) => void): void;
  enqueueRaw(data: ArrayLike<number>, options?: ISendOptions): void;

  /**
  * Send message payload to a specific client.
   *
   * @param type String or Number identifier the client SDK will use to receive this message
   * @param message Message payload. (automatically encoded with msgpack.)
   * @param options
   */
  send(type: string | number, message?: any, options?: ISendOptions): void;
  send(message: Schema, options?: ISendOptions): void;

  /**
   * Send raw bytes to this specific client.
   *
   * @param type String or Number identifier the client SDK will use to receive this message
   * @param bytes Raw byte array payload
   * @param options
   */
  sendBytes(type: string | number, bytes: number[] | Uint8Array, options?: ISendOptions): void;

  /**
   * Disconnect this client from the room.
   *
   * @param code Custom close code. Default is 1000
   * @param data
   * @see https://docs.colyseus.io/colyseus/server/room/#leavecode-number
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
