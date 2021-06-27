import { uWebSocketsTransport } from "@colyseus/uwebsockets-transport";
import expressify from "uwebsockets-express";

import Arena from "../src";

export default Arena({
    getId: () => "My App 1.0.0",

    /**
     * OPTIONAL:
     * - use uWebSockets.js transport
     * - use uWebSockets + Express compatibility layer!
    getTransport: function () {
        const transport = new uWebSocketsTransport({});
        this.initializeExpress(expressify(transport.app));
        return transport;
    },
     */

    initializeExpress: (app) => {
        console.log("custom: initializeExpress()");
        app.get("/", (req, res) => res.send("Hello world!"));
    },

    initializeGameServer: (gameServer) => {
        console.log("custom: initializeGameServer()");
        // gameServer.define("something", );
    },

    beforeListen: () => {
        console.log("custom: beforeListen()");
    }

});