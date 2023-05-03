export * from "@colyseus/core";

//
// 0.14.x compatibility:
// each "presence", "transport", and "driver" implementation have been extracted from the core.
//
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
Server.prototype['getDefaultTransport'] = function(options: any) {
    return new WebSocketTransport(options);
}
export { RedisPresence } from '@colyseus/redis-presence';
export { RedisDriver } from '@colyseus/redis-driver';
