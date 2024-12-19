import { uWebSocketsTransport } from "@colyseus/uwebsockets-transport";

import Arena from "../src";

export default Arena({
    getId: () => "My App 1.0.0",

    /**
     * OPTIONAL:
     * - use uWebSockets.js transport
     * - use uWebSockets + Express compatibility layer!
     */
    initializeTransport: (options) => new uWebSocketsTransport({
        ...options,
    }),

    initializeExpress: (app) => {
        // console.log("custom: initializeExpress()");
        app.get("/", (req, res) => res.end("Hello world!"));
    },

    initializeGameServer: (gameServer) => {
        // console.log("custom: initializeGameServer()");
        // gameServer.define("something", );
    },

    beforeListen: () => {
        // console.log("custom: beforeListen()");
    }

});
