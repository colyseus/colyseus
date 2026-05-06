import { Server, registerRoomDefinitions } from "colyseus";
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
//#region \0virtual:colyseus-server-entry
var clientDir = join(dirname(fileURLToPath(import.meta.url)), "../client");
var entry = await import("./assets/vite-B2kA6La0.js");
var server = entry.server ?? entry.default?.server;
var rooms = entry.rooms ?? entry.default?.rooms;
if (server) {
	await server["_onTransportReady"];
	if (server.transport.getExpressApp) {
		const app = server.transport.getExpressApp();
		app.use(express.static(clientDir));
		app.get("*all", (req, res) => res.sendFile(join(clientDir, "index.html")));
	}
	server.listen(2567);
} else if (rooms) {
	const gameServer = new Server();
	registerRoomDefinitions(rooms);
	gameServer.listen(2567);
} else throw new Error("[colyseus] Server entry should export `server = defineServer(...)` or `rooms`.");
//#endregion
export {};
