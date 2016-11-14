/* ///<reference path="./vendor.d.ts"/> */

export { Server } from "./Server";
export { Room } from "./Room";
export { Protocol } from "./Protocol";

import * as WebSocket from "ws";
export type Client = WebSocket & { id: string };
