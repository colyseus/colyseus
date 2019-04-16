import Clock, { Delayed } from '@gamestdio/timer';
import http from 'http';
import nanoid from 'nanoid';
import WebSocket from 'ws';

// Core classes
export { Server } from './Server';
export { Room, RoomAvailable } from './Room';
export { Protocol } from './Protocol';
export { RegisteredHandler } from './matchmaker/RegisteredHandler';

// Presence
export { Presence } from './presence/Presence';
export { LocalPresence } from './presence/LocalPresence';
export { RedisPresence } from './presence/RedisPresence';

// Serializers
export { FossilDeltaSerializer } from './serializer/FossilDeltaSerializer';
export { SchemaSerializer } from './serializer/SchemaSerializer';
export { serialize } from './serializer/Serializer';

// Utilities
export { Clock, Delayed };
export { nonenumerable as nosync } from 'nonenumerable';
export function generateId() { return nanoid(9); }
export function isValidId(id: string) { return id && /^[a-zA-Z0-9_\-]{9}$/.test(id); }

// Export 'WebSocket' as 'Client' with 'id' property.
export type Client = WebSocket & {
  upgradeReq?: http.IncomingMessage; // cross-compatibility for ws (v3.x+) and uws
  id: string;
  options: any;
  sessionId: string;
  pingCount: number; // ping / pong
  remote?: boolean; // is this a remote client, from another process?
  auth?: any; // custom data set through Room's verifyClient method.
};
