/**
 * Re-export common packages from the colyseus bundle.
 */
export * from "@colyseus/auth";
export * from "@colyseus/core";
export * from "@colyseus/tools";
export * from "@colyseus/monitor";
export * from "@colyseus/playground";
export * from "@colyseus/ws-transport";
export * from "@colyseus/redis-presence";
export * from "@colyseus/redis-driver";

//
// 0.14.x compatibility:
// each "presence", "transport", and "driver" implementation have been extracted from the core.
//
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
Server.prototype['getDefaultTransport'] = function(options: any) {
    return new WebSocketTransport(options);
}
