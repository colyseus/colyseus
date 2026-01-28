import type { ITransport, ITransportEventMap } from "./transport/ITransport.ts";
import { H3TransportTransport } from "./transport/H3Transport.ts";
import { WebSocketTransport } from "./transport/WebSocketTransport.ts";
import { CloseCode } from "@colyseus/shared-types";

const onOfflineListeners: (() => void)[] = [];
const hasGlobalEventListeners = typeof (addEventListener) === "function" && typeof (removeEventListener) === "function";
if (hasGlobalEventListeners) {
    /**
     * Detects when the network is offline and closes all connections.
     * (When switching wifi networks, etc.)
     */
    addEventListener("offline", () => {
        console.warn(`@colyseus/sdk: 🛑 Network offline. Closing ${onOfflineListeners.length} connection(s)`);
        onOfflineListeners.forEach((listener) => listener());
    }, false);
}

export class Connection implements ITransport {
    transport: ITransport;
    events: ITransportEventMap = {};

    url?: string;
    options?: any;

    #_offlineListener = (hasGlobalEventListeners) ? () => this.close(CloseCode.MAY_TRY_RECONNECT) : null;

    constructor(protocol?: string) {
        switch (protocol) {
            case "h3":
                this.transport = new H3TransportTransport(this.events);
                break;

            default:
                this.transport = new WebSocketTransport(this.events);
                break;
        }
    }

    connect(url: string, options?: any): void {
        if (hasGlobalEventListeners) {
            const onOpen = this.events.onopen;
            this.events.onopen = (ev: any) => {
                onOfflineListeners.push(this.#_offlineListener);
                onOpen?.(ev);
            };

            const onClose = this.events.onclose;
            this.events.onclose = (ev: any) => {
                onOfflineListeners.splice(onOfflineListeners.indexOf(this.#_offlineListener), 1);
                onClose?.(ev);
            };
        }

        this.url = url;
        this.options = options;
        this.transport.connect(url, options);
    }

    send(data: Buffer | Uint8Array): void {
        this.transport.send(data);
    }

    sendUnreliable(data: Buffer | Uint8Array): void {
        this.transport.sendUnreliable(data);
    }

    reconnect(queryParams: { reconnectionToken: string, skipHandshake?: boolean }): void {
        const url = new URL(this.url);

        // override query params
        for (const key in queryParams) {
            url.searchParams.set(key, queryParams[key]);
        }

        this.transport.connect(url.toString(), this.options);
    }

    close(code?: number, reason?: string): void {
        this.transport.close(code, reason);
    }

    get isOpen() {
        return this.transport.isOpen;
    }

}
