import * as WebSocket from "ws";
import * as shortid from "shortid";
import * as http from "http";
import Clock, { Delayed } from "@gamestdio/timer";

// Core classes
export { Server } from "./Server";
export { Room } from "./Room";
export { Protocol } from "./Protocol";
export { RegisteredHandler } from "./MatchMaker";

// State Helper Types
export type EntityMap<T> = {[ entityId:string ]: T};

// Utilities
export { Clock, Delayed }
export { nonenumerable as nosync } from "nonenumerable";
export function generateId () { return shortid.generate(); }
export function isValidId (id: any) { return shortid.isValid(id); }

// Export 'WebSocket' as 'Client' with 'id' property.
export type Client = WebSocket & {
  upgradeReq?: http.IncomingMessage; // cross-compatibility for ws (v3.x+) and uws
  id: string;
  options: any;
  sessionId: string;
  remote?: boolean; // is this a remote client, from another process?
};