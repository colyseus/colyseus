import WebSocket from "ws";

import { Client, ClientState, ISendOptions } from "../Transport";
import { getMessageBytes, Protocol } from "../../Protocol";
import { Schema } from "@colyseus/schema";

const SEND_OPTS = { binary: true };

export class WebSocketClient implements Client {
  sessionId: string;
  state: ClientState = ClientState.JOINING;
  _enqueuedMessages: any[] = [];

  constructor (
    public id: string,
    public ref: WebSocket,
  ) {
    this.sessionId = id;
  }

  send(messageOrType: any, messageOrOptions?: any | ISendOptions, options?: ISendOptions) {
    //
    // TODO: implement `options.afterNextPatch`
    //

    if (messageOrType instanceof Schema) {
      this.raw(getMessageBytes[Protocol.ROOM_DATA_SCHEMA](messageOrType));

    } else {
      this.raw(getMessageBytes[Protocol.ROOM_DATA](messageOrType, messageOrOptions));
    }
  }

  raw(data: ArrayLike<number>, options?: ISendOptions) {
    if (this.ref.readyState !== WebSocket.OPEN) {
      console.warn("trying to send data to inactive client", this.sessionId);
      return;
    }

    if (this.state === ClientState.JOINING) {
      // sending messages during `onJoin`.
      // - the client-side cannot register "onMessage" callbacks at this point.
      // - enqueue the messages to be send after JOIN_ROOM message has been sent
      this._enqueuedMessages.push(data);
      return;
    }

    this.ref.send(data, SEND_OPTS);
  }

  error(code: number, message?: string) {
    // if (client.readyState !== WebSocket.OPEN) { return; }
    // const buff = Buffer.allocUnsafe(1 + utf8Length(message));
    // buff.writeUInt8(Protocol.JOIN_ERROR, 0);
    // utf8Write(buff, 1, message);
    // client.send(buff, { binary: true });
  }

  get readyState() {
    return this.ref.readyState;
  }

  close(code?: number, data?: string) {
    this.ref.close(code, data);
  }

  toJSON() {
    return { sessionId: this.sessionId, readyState: this.readyState };
  }
}