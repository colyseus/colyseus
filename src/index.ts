import * as WebSocket from "uws";
import * as shortid from "shortid";

// Core classes
export { Server } from "./Server";
export { ClusterServer } from "./ClusterServer";
export { Room } from "./Room";
export { Protocol } from "./Protocol";

// State Helper Types
export type EntityMap<T> = {[ entityId:string ]: T};

// Utilities
export { nonenumerable as nosync } from "nonenumerable";
export function generateId () { return shortid.generate(); }
export function isValidId (id: any) { return shortid.isValid(id); }

// Export 'WebSocket' as 'Client' with 'id' property.
export type Client = WebSocket & {
  id: string;
  sessionId: string;
};
