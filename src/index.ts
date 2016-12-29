/* ///<reference path="./vendor.d.ts"/> */
import * as WebSocket from "ws";
import * as shortid from "shortid";

// Core classes
export { Server } from "./Server";
export { Room } from "./Room";
export { Protocol } from "./Protocol";

// State Helper Types
export type EntityMap<T> = {[ entityId:string ]: T};
export function generateId () { return shortid.generate(); }

// Export 'WebSocket' as 'Client' with 'id' property.
export type Client = WebSocket & { id: string };
