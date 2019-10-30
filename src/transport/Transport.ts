import * as http from 'http';
import * as https from 'https';
import * as net from 'net';

export abstract class Transport {
    public server: net.Server | http.Server | https.Server;

    public abstract listen(port?: number, hostname?: string, backlog?: number, listeningListener?: Function): this;
    public abstract shutdown(): void;

    public address() { return this.server.address() as net.AddressInfo; }
}

export { TCPTransport } from './TCPTransport';
export { WebSocketTransport } from './WebSocketTransport';
