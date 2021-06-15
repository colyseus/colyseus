import WebSocket from 'ws';

import { Schema } from '@colyseus/schema';
import { getMessageBytes, Protocol } from '../../Protocol';
import {IBroadcastOptions} from '../../Room';
import { Client, ClientState, ISendOptions } from '../Transport';

const SEND_OPTS = { binary: true };

export class WebSocketClient implements Client {
  public sessionId: string;
  public state: ClientState = ClientState.JOINING;
  public _enqueuedMessages: any[] = [];
  public _afterNextPatchSends: IArguments[] = [];
  public clients: Client[] = [];

  constructor(
    public id: string,
    public ref: WebSocket,
  ) {
    this.sessionId = id;
  }

  public send(messageOrType: any, messageOrOptions?: any | ISendOptions, options?: ISendOptions) {
    //
    // TODO: implement `options.afterNextPatch`
    //
    const isSchema = (typeof(messageOrType) === 'object');
    const opts: ISendOptions = ((isSchema) ? messageOrOptions : options);

    if (opts && opts.afterNextPatch) {
      delete opts.afterNextPatch;
      this._afterNextPatchSends.push(arguments);
      return;
    }

    if (isSchema) {
      this.sendMessageSchema(messageOrType as Schema, opts);
    } else {
      this.sendMessageType(messageOrType as string, messageOrOptions, opts);
    }

    this.enqueueRaw(
      (messageOrType instanceof Schema)
        ? getMessageBytes[Protocol.ROOM_DATA_SCHEMA](messageOrType)
        : getMessageBytes[Protocol.ROOM_DATA](messageOrType, messageOrOptions),
      options,
    );
  }

  private sendMessageSchema<T extends Schema>(message: T, options: IBroadcastOptions = {}) {
    const encodedMessage = getMessageBytes[Protocol.ROOM_DATA_SCHEMA](message);

    let numClients = this.clients.length;
    while (numClients--) {
      const client = this.clients[numClients];

      if (options.except !== client) {
        client.enqueueRaw(encodedMessage);
      }
    }
  }

  private sendMessageType(type: string, message?: any, options: IBroadcastOptions = {}) {
    const encodedMessage = getMessageBytes[Protocol.ROOM_DATA](type, message);

    let numClients = this.clients.length;
    while (numClients--) {
      const client = this.clients[numClients];

      if (options.except !== client) {
        client.enqueueRaw(encodedMessage);
      }
    }
  }

  public enqueueRaw(data: ArrayLike<number>, options?: ISendOptions) {
    if (this.state === ClientState.JOINING) {
      // sending messages during `onJoin`.
      // - the client-side cannot register "onMessage" callbacks at this point.
      // - enqueue the messages to be send after JOIN_ROOM message has been sent
      this._enqueuedMessages.push(data);
      return;
    }

    this.raw(data, options);
  }

  public raw(data: ArrayLike<number>, options?: ISendOptions, cb?: (err?: Error) => void) {
    if (this.ref.readyState !== WebSocket.OPEN) {
      console.warn('trying to send data to inactive client', this.sessionId);
      return;
    }

    this.ref.send(data, SEND_OPTS, cb);
  }

  public error(code: number, message: string = '', cb?: (err?: Error) => void) {
    this.raw(getMessageBytes[Protocol.ERROR](code, message), undefined, cb);
  }

  get readyState() {
    return this.ref.readyState;
  }

  public leave(code?: number, data?: string) {
    this.ref.close(code, data);
  }

  public close(code?: number, data?: string) {
    console.warn('DEPRECATION WARNING: use client.leave() instead of client.close()');
    try {
      throw new Error();
    } catch (e) {
      console.log(e.stack);
    }
    this.leave(code, data);
  }

  public toJSON() {
    return { sessionId: this.sessionId, readyState: this.readyState };
  }
}
