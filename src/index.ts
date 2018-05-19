import Clock, { Delayed } from '@gamestdio/timer';
import * as http from 'http';
import * as shortid from 'shortid';
import * as WebSocket from 'ws';

// Core classes
export { Server } from './Server';
export { Room, RoomAvailable } from './Room';
export { Protocol } from './Protocol';
export { RegisteredHandler } from './matchmaker/RegisteredHandler';

// Presence
export { Presence } from './presence/Presence';
export { LocalPresence } from './presence/LocalPresence';
export { RedisPresence } from './presence/RedisPresence';
export { MemsharedPresence } from './presence/MemsharedPresence';

// State Helper Types
export interface EntityMap<T> {[ entityId: string ]: T; }

// Utilities
export { Clock, Delayed };
export { nonenumerable as nosync } from 'nonenumerable';
export function generateId() { return shortid.generate(); }
export function isValidId(id: any) { return shortid.isValid(id); }

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
