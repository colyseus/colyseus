import Clock, { Delayed } from '@gamestdio/timer';
import http from 'http';
import nanoid from 'nanoid';
import WebSocket from 'ws';

// Core classes
export { Server } from './Server';
export { Room } from './Room';
export { Protocol } from './Protocol';
export { RegisteredHandler, SortOptions } from './matchmaker/RegisteredHandler';

// Presence
export { Presence } from './presence/Presence';
export { LocalPresence } from './presence/LocalPresence';
export { RedisPresence } from './presence/RedisPresence';

// Default rooms
export { RelayRoom } from './rooms/RelayRoom';

// Serializers
export { FossilDeltaSerializer } from './serializer/FossilDeltaSerializer';
export { SchemaSerializer } from './serializer/SchemaSerializer';
export { serialize } from './serializer/Serializer';

// Utilities
export { Clock, Delayed };
export { nonenumerable as nosync } from 'nonenumerable';
export function generateId() { return nanoid(9); }

export enum ClientState { JOINING, JOINED, RECONNECTED }

// Export 'WebSocket' as 'Client' with 'id' property.
export type Client = WebSocket & {
  upgradeReq?: http.IncomingMessage; // cross-compatibility for ws (v3.x+) and uws
  // id: string;

  id: string;
  sessionId: string; // TODO: remove sessionId on version 1.0.0
  auth?: any;

  pingCount: number; // ping / pong

  state: ClientState;
  _enqueuedMessages: any;
};
