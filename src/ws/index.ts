import * as http from "http";
import * as ws from "ws";
import * as uws from "uws";

var dep;

try {
    dep = require("uws");

} catch (e) {
    dep = require("ws");

    // display warning message only once (master process)
    if (!process.send) {
        console.warn("'uws' not installed. using 'ws' instead.");
    }
}

export type WebSocketServer = ws.Server & uws.Server;
export const WebSocketServer: WebSocketServer = dep.Server;

export type IServerOptions = ws.ServerOptions & uws.IServerOptions;

export default dep as ws & uws;