import NodeWebSocket from "ws";
import { CloseCode } from "@colyseus/shared-types";
import type { ITransport, ITransportEventMap } from "./ITransport.ts";

const WebSocket = globalThis.WebSocket || NodeWebSocket;

export class WebSocketTransport implements ITransport {
    ws: WebSocket | NodeWebSocket;
    protocols?: string | string[];

    events: ITransportEventMap;

    constructor(events: ITransportEventMap) {
        this.events = events;
    }

    public send(data: Buffer | Uint8Array): void {
        this.ws.send(data);
    }

    public sendUnreliable(data: Uint8Array): void {
        console.warn("@colyseus/sdk: The WebSocket transport does not support unreliable messages");
    }

    /**
     * @param url URL to connect to
     * @param headers custom headers to send with the connection (only supported in Node.js. Web Browsers do not allow setting custom headers)
     */
    public connect(url: string, headers?: any): void {
        try {
            // Node or Bun environments (supports custom headers)
            this.ws = new WebSocket(url, { headers, protocols: this.protocols });

        } catch (e) {
            // browser environment (custom headers not supported)
            this.ws = new WebSocket(url, this.protocols);
        }

        this.ws.binaryType = 'arraybuffer';
        this.ws.onopen = (event) => this.events.onopen?.(event);
        this.ws.onmessage = (event) => this.events.onmessage?.(event);
        this.ws.onclose = (event) => this.events.onclose?.(event);
        this.ws.onerror = (event) => this.events.onerror?.(event);
    }

    public close(code?: number, reason?: string) {
        //
        // trigger the onclose event immediately if the code is MAY_TRY_RECONNECT
        // when "offline" event is triggered, the close frame is delayed. this
        // way client can try to reconnect immediately.
        //
        if (code === CloseCode.MAY_TRY_RECONNECT && this.events.onclose) {
            this.ws.onclose = null;
            this.events.onclose({ code, reason });
        }

        // then we close the connection
        this.ws.close(code, reason);
    }

    get isOpen() {
        return this.ws.readyState === WebSocket.OPEN;
    }

}
