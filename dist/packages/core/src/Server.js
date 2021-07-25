"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Server = void 0;
const Debug_1 = require("./Debug");
const matchMaker = __importStar(require("./MatchMaker"));
const Room_1 = require("./Room");
const Utils_1 = require("./Utils");
const _1 = require(".");
const discovery_1 = require("./discovery");
const LocalPresence_1 = require("./presence/LocalPresence");
const driver_1 = require("./matchmaker/driver");
class Server {
    constructor(options = {}) {
        this.processId = _1.generateId();
        this.matchmakeRoute = 'matchmake';
        this.allowedRoomNameChars = /([a-zA-Z_\-0-9]+)/gi;
        this.onShutdownCallback = () => Promise.resolve();
        const { gracefullyShutdown = true } = options;
        this.presence = options.presence || new LocalPresence_1.LocalPresence();
        this.driver = options.driver || new driver_1.LocalDriver();
        // setup matchmaker
        matchMaker.setup(this.presence, this.driver, this.processId);
        // "presence" option is not used from now on
        delete options.presence;
        this.attach(options);
        if (gracefullyShutdown) {
            Utils_1.registerGracefulShutdown((err) => this.gracefullyShutdown(true, err));
        }
    }
    attach(options) {
        /**
         * Display deprecation warnings for moved Transport options.
         * TODO: Remove me on 0.15
         */
        if (options.pingInterval !== undefined ||
            options.pingMaxRetries !== undefined ||
            options.server !== undefined ||
            options.verifyClient !== undefined) {
            console.warn("DEPRECATION WARNING: 'pingInterval', 'pingMaxRetries', 'server', and 'verifyClient' Server options will be permanently moved to WebSocketTransport on v0.15");
            console.warn(`new Server({
  transport: new WebSocketTransport({
    pingInterval: ...,
    pingMaxRetries: ...,
    server: ...,
    verifyClient: ...
  })
})`);
            console.warn("👉 Documentation: https://docs.colyseus.io/server/transport/");
        }
        const transport = options.transport || this.getDefaultTransport(options);
        delete options.transport;
        this.transport = transport;
        if (this.transport.server) {
            this.transport.server.once('listening', () => this.registerProcessForDiscovery());
            this.attachMatchMakingRoutes(this.transport.server);
        }
    }
    /**
     * Bind the server into the port specified.
     *
     * @param port
     * @param hostname
     * @param backlog
     * @param listeningListener
     */
    async listen(port, hostname, backlog, listeningListener) {
        this.port = port;
        return new Promise((resolve, reject) => {
            this.transport.server?.on('error', (err) => reject(err));
            this.transport.listen(port, hostname, backlog, (err) => {
                if (listeningListener) {
                    listeningListener(err);
                }
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    }
    registerProcessForDiscovery() {
        // register node for proxy/service discovery
        discovery_1.registerNode(this.presence, {
            port: this.port,
            processId: this.processId,
        });
    }
    /**
     * Define a new type of room for matchmaking.
     *
     * @param name public room identifier for match-making.
     * @param handler Room class definition
     * @param defaultOptions default options for `onCreate`
     */
    define(name, handler, defaultOptions) {
        return matchMaker.defineRoomType(name, handler, defaultOptions);
    }
    async gracefullyShutdown(exit = true, err) {
        await discovery_1.unregisterNode(this.presence, {
            port: this.port,
            processId: this.processId,
        });
        try {
            await matchMaker.gracefullyShutdown();
            this.transport.shutdown();
            this.presence.shutdown();
            this.driver.shutdown();
            await this.onShutdownCallback();
        }
        catch (e) {
            Debug_1.debugAndPrintError(`error during shutdown: ${e}`);
        }
        finally {
            if (exit) {
                process.exit(err ? 1 : 0);
            }
        }
    }
    /**
     * Add simulated latency between client and server.
     * @param milliseconds round trip latency in milliseconds.
     */
    simulateLatency(milliseconds) {
        console.warn(`📶️❗ Colyseus latency simulation enabled → ${milliseconds}ms latency for round trip.`);
        const halfwayMS = (milliseconds / 2);
        this.transport.simulateLatency(halfwayMS);
        /* tslint:disable:no-string-literal */
        const _onMessage = Room_1.Room.prototype['_onMessage'];
        /* tslint:disable:no-string-literal */
        Room_1.Room.prototype['_onMessage'] = function (client, buffer) {
            // uWebSockets.js: duplicate buffer because it is cleared at native layer before the timeout.
            const cachedBuffer = Buffer.from(buffer);
            setTimeout(() => _onMessage.call(this, client, cachedBuffer), halfwayMS);
        };
    }
    /**
     * Register a callback that is going to be executed before the server shuts down.
     * @param callback
     */
    onShutdown(callback) {
        this.onShutdownCallback = callback;
    }
    getDefaultTransport(_) {
        throw new Error("Please provide a 'transport' layer. Default transport not set.");
    }
    attachMatchMakingRoutes(server) {
        const listeners = server.listeners('request').slice(0);
        server.removeAllListeners('request');
        server.on('request', (req, res) => {
            if (req.url.indexOf(`/${this.matchmakeRoute}`) !== -1) {
                Debug_1.debugMatchMaking('received matchmake request: %s', req.url);
                this.handleMatchMakeRequest(req, res);
            }
            else {
                for (let i = 0, l = listeners.length; i < l; i++) {
                    listeners[i].call(server, req, res);
                }
            }
        });
    }
    async handleMatchMakeRequest(req, res) {
        const headers = {
            'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept',
            'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Max-Age': 2592000,
            // ...
        };
        if (req.method === 'OPTIONS') {
            res.writeHead(204, headers);
            res.end();
        }
        else if (req.method === 'POST') {
            const matchedParams = req.url.match(this.allowedRoomNameChars);
            const matchmakeIndex = matchedParams.indexOf(this.matchmakeRoute);
            const method = matchedParams[matchmakeIndex + 1];
            const name = matchedParams[matchmakeIndex + 2] || '';
            const data = [];
            req.on('data', (chunk) => data.push(chunk));
            req.on('end', async () => {
                headers['Content-Type'] = 'application/json';
                res.writeHead(200, headers);
                const clientOptions = JSON.parse(Buffer.concat(data).toString());
                try {
                    const response = await matchMaker.controller.invokeMethod(method, name, clientOptions);
                    res.write(JSON.stringify(response));
                }
                catch (e) {
                    res.write(JSON.stringify({ code: e.code, error: e.message, }));
                }
                res.end();
            });
        }
        else if (req.method === 'GET') {
            const matchedParams = req.url.match(this.allowedRoomNameChars);
            const roomName = matchedParams[matchedParams.length - 1];
            headers['Content-Type'] = 'application/json';
            res.writeHead(200, headers);
            res.write(JSON.stringify(await matchMaker.controller.getAvailableRooms(roomName)));
            res.end();
        }
    }
}
exports.Server = Server;
//# sourceMappingURL=Server.js.map