import { Server, ServerOptions } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

Server.prototype['getDefaultTransport'] = function(options: ServerOptions) {
    return new WebSocketTransport(options);
}

export * from "@colyseus/core";