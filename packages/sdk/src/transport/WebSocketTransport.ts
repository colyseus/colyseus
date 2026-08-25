import NodeWebSocket from "ws";
import { CloseCode } from "@colyseus/shared-types";
import type { ITransport, ITransportEventMap } from "./ITransport.ts";

const WebSocket = globalThis.WebSocket || NodeWebSocket;

// Once per process — the fallback is per-send, and a 60Hz input ring would
// otherwise flood the console.
let warnedNoUnreliableChannel = false;

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

    /**
     * WebSocket has no unreliable channel, so this falls back to the reliable
     * one — which is what every caller is written against (see `sendRequest`,
     * and the input handle's redundancy ring). Dropping instead loses every
     * `mode:"unreliable"` input and request silently: the server never sees
     * them, and the client's pending set grows without bound because nothing
     * is ever acked.
     *
     * The cost of falling back is bandwidth, not correctness — an input ring
     * carries `historySize` redundant slots the ordered channel doesn't need,
     * and the server dedupes them by wire seq exactly as it would over
     * datagrams. Use `@colyseus/h3-transport` for real unreliable delivery.
     */
    public sendUnreliable(data: Buffer | Uint8Array): void {
        if (!warnedNoUnreliableChannel) {
            warnedNoUnreliableChannel = true;
            console.warn("@colyseus/sdk: the WebSocket transport has no unreliable channel — sending `mode:\"unreliable\"` traffic reliably instead. Use @colyseus/h3-transport (WebTransport) for datagram delivery.");
        }
        this.send(data);
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
