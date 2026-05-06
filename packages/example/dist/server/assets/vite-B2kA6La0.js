import { createEndpoint, createRouter, defineRoom, defineServer, monitor, playground } from "colyseus";
import { CloseCode, Room, validate } from "@colyseus/core";
import { schema } from "@colyseus/schema";
import { z } from "zod";
//#region src/MyRoom.ts
var VERSION = 5;
var Player = schema({
	x: "number",
	y: "number"
});
var MyRoomState = schema({
	mapWidth: "number",
	mapHeight: "number",
	players: { map: Player }
});
var thirdPartyMessages = {
	nopayload: function(client, message) {
		this.broadcast("hello", {});
		client.send("hello", {});
	},
	with_validation: validate(z.object({ name: z.string() }), function(client, message) {
		this.broadcast("obj_message", { message: "hello" });
		client.send("obj_message", { message: "hello" });
	}),
	_: function(client, type, message) {
		this.broadcast("hello", {});
	}
};
var MyRoom = class extends Room {
	constructor(..._args) {
		super(..._args);
		this.state = new MyRoomState();
		this.messages = {
			...thirdPartyMessages,
			move: validate(z.object({
				x: z.number(),
				y: z.number(),
				z: z.number().optional()
			}), (client, message) => {
				const player = this.state.players.get(client.sessionId);
				player.x = message.x;
				player.y = message.y;
				console.log("MOVE", {
					sessionId: client.sessionId,
					VERSION
				});
			}),
			nopayload_2: (client, message) => {
				client.send("obj_message", { message: "hello" });
				this.broadcast("obj_message", { message: "hello" });
			},
			_: (client, type, message) => {
				this.broadcast(type, message);
			}
		};
	}
	onCreate(options) {
		this.seatReservationTimeout = 31;
		this.state.mapWidth = 800;
		this.state.mapHeight = 600;
		this.onMessage("__move", (client, message) => {});
		this.onMessage("__dummy", (client, message) => {});
		this.onMessage("move_with_validation", z.object({
			x: z.number(),
			y: z.number()
		}), (client, message) => {
			const player = this.state.players.get(client.sessionId);
			player.x = message.x;
			player.y = message.y;
		});
		this.setSimulationInterval(() => this.update());
	}
	onJoin(client, options) {
		const player = new Player();
		player.x = Math.random() * this.state.mapWidth;
		player.y = Math.random() * this.state.mapHeight;
		this.state.players.set(client.sessionId, player);
		console.log("ON JOIN", { VERSION });
	}
	onReconnect(client) {
		console.log(client.sessionId, "reconnected!");
	}
	update() {}
	async onLeave(client, code) {
		try {
			if (code === CloseCode.CONSENTED) throw new Error("consented leave");
			console.log(client.sessionId, "waiting for reconnection...");
			await this.allowReconnection(client, 10);
			console.log(client.sessionId, "reconnected!");
		} catch (e) {
			this.state.players.delete(client.sessionId);
			console.log(client.sessionId, "left!");
		}
	}
	onCacheRoom() {
		return { hello: true };
	}
	onRestoreRoom(cached) {
		console.log("onRestoreRoom", cached);
	}
	onDispose() {
		console.log("room", this.roomId, "disposing...");
	}
	onBeforeShutdown() {
		this.clock.setTimeout(() => this.disconnect(), 5 * 1e3);
	}
};
//#endregion
//#region src/server/vite.ts
var server = defineServer({
	rooms: { my_room: defineRoom(MyRoom) },
	express: (app) => {
		app.get("/express-hello", (req, res) => {
			res.json({ message: "Hello from Express!" });
		});
		app.use("/playground", playground());
		app.use("/monitor", monitor());
	},
	routes: createRouter({
		hello: createEndpoint("/hello", { method: "GET" }, async (ctx) => {
			return { message: "Hello world!" };
		}),
		time: createEndpoint("/time", { method: "GET" }, async (ctx) => {
			return { time: Date.now() };
		})
	})
});
//#endregion
export { server };
