"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.listen = void 0;
var fs_1 = __importDefault(require("fs"));
var http_1 = __importDefault(require("http"));
var path_1 = __importDefault(require("path"));
var cors_1 = __importDefault(require("cors"));
var express_1 = __importDefault(require("express"));
var colyseus_1 = require("colyseus");
var dotenv_1 = __importDefault(require("dotenv"));
/**
 * Do not auto-load `${environment}.env` file when using Arena service.
 */
if (process.env.NODE_ARENA !== "true") {
    var envFilename = (process.env.NODE_ENV === "production")
        ? "arena.env"
        : (process.env.NODE_ENV || "development") + ".env";
    var envPath = path_1.default.resolve(path_1.default.dirname(((_a = require === null || require === void 0 ? void 0 : require.main) === null || _a === void 0 ? void 0 : _a.filename) || process.cwd()), "..", envFilename);
    if (fs_1.default.existsSync(envPath)) {
        dotenv_1.default.config({ path: envPath });
        console.log("\u2705  " + envFilename + " loaded.");
    }
    else {
        console.log("\u26A0\uFE0F  " + envFilename + " not found.");
    }
}
var ALLOWED_KEYS = ['getId', 'initializeExpress', 'initializeGameServer', 'beforeListen'];
function default_1(options) {
    for (var key in options) {
        if (ALLOWED_KEYS.indexOf(key) === -1) {
            throw new Error("Invalid option '" + key + "'. Allowed options are: " + ALLOWED_KEYS.join(", "));
        }
        else if (typeof (options[key]) !== "function") {
            throw new Error("'" + key + "' should be a function.");
        }
    }
    return options;
}
exports.default = default_1;
/**
 * Listen on your development environment
 * @param options Arena options
 * @param port Port number to bind Colyseus + Express
 */
function listen(options, port) {
    var _a, _b, _c, _d;
    if (port === void 0) { port = Number(process.env.PORT || 2567); }
    var app = express_1.default();
    var server = http_1.default.createServer(app);
    var gameServer = new colyseus_1.Server({ server: server, });
    // Enable CORS + JSON parsing.
    app.use(cors_1.default());
    app.use(express_1.default.json());
    (_a = options.initializeGameServer) === null || _a === void 0 ? void 0 : _a.call(options, gameServer);
    (_b = options.initializeExpress) === null || _b === void 0 ? void 0 : _b.call(options, app);
    (_c = options.beforeListen) === null || _c === void 0 ? void 0 : _c.call(options);
    gameServer.listen(port);
    var appId = (_d = options.getId) === null || _d === void 0 ? void 0 : _d.call(options);
    if (appId) {
        console.log("" + appId);
    }
    console.log("\u2694\uFE0F  Listening on ws://localhost:" + port);
}
exports.listen = listen;
