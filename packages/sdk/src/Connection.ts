import type { ITransport, ITransportEventMap } from "./transport/ITransport.ts";
import { H3TransportTransport } from "./transport/H3Transport.ts";
import { WebSocketTransport } from "./transport/WebSocketTransport.ts";

export class Connection implements ITransport {
    transport: ITransport;
    events: ITransportEventMap = {};

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
        this.transport.connect.call(this.transport, url, options);
    }

    send(data: Buffer | Uint8Array): void {
        this.transport.send(data);
    }

    sendUnreliable(data: Buffer | Uint8Array): void {
        this.transport.sendUnreliable(data);
    }

    close(code?: number, reason?: string): void {
        this.transport.close(code, reason);
    }

    get isOpen() {
        return this.transport.isOpen;
    }

}
