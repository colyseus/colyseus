import WebSocket from "ws";

import { Client, ClientState } from "../Transport";

export class WebSocketClient implements Client {
  sessionId: string;
  state: ClientState;

  constructor (
    public id: string,
    public ref: WebSocket,
  ) {
    this.sessionId = id;
  }

  send<T = any>(type: string | number, data?: T) {
  }

  raw(data: any, options?) {
    this.ref.send(data, options);
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