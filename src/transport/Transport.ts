import * as http from 'http';
import * as https from 'https';
import * as net from 'net';

import { Schema } from '@colyseus/schema';
import { EventEmitter } from 'events';

export abstract class Transport {
    public server: net.Server | http.Server | https.Server;

    public abstract listen(port?: number, hostname?: string, backlog?: number, listeningListener?: Function): this;
    public abstract shutdown(): void;

    public address() { return this.server.address() as net.AddressInfo; }
}

export interface ISendOptions {
  afterNextPatch?: boolean;
}

export enum ClientState { JOINING, JOINED, RECONNECTED }

export interface Client {
  readyState: number;

  id: string;
  sessionId: string; // TODO: remove sessionId on version 1.0.0
  state: ClientState;

  ref: EventEmitter;

  upgradeReq?: http.IncomingMessage; // cross-compatibility for ws (v3.x+) and uws

  /**
   * auth data provided by your `onAuth`
   */
  auth?: any;
  pingCount?: number; // ping / pong
  _enqueuedMessages?: any[];

  raw(data: ArrayLike<number>, options?: ISendOptions): void;
  enqueueRaw(data: ArrayLike<number>, options?: ISendOptions): void;

  send(type: string | number, message?: any, options?: ISendOptions): void;
  send(message: Schema, options?: ISendOptions): void;

  error(code: number, message?: string): void;
  leave(code?: number, data?: string): void;
  close(code?: number, data?: string): void;
}
