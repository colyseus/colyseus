"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayRoom = void 0;
const schema_1 = require("@colyseus/schema");
const Room_1 = require("../Room");
/**
 * Create another context to avoid these types from being in the user's global `Context`
 */
const context = new schema_1.Context();
class Player extends schema_1.Schema {
}
schema_1.defineTypes(Player, {
    connected: 'boolean',
    name: 'string',
    sessionId: 'string',
}, context);
class State extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.players = new schema_1.MapSchema();
    }
}
schema_1.defineTypes(State, {
    players: { map: Player },
}, context);
/**
 * client.joinOrCreate("relayroom", {
 *   maxClients: 10,
 *   allowReconnectionTime: 20
 * });
 */
class RelayRoom extends Room_1.Room {
    constructor() {
        super(...arguments);
        this.allowReconnectionTime = 0;
    }
    onCreate(options) {
        this.setState(new State());
        if (options.maxClients) {
            this.maxClients = options.maxClients;
        }
        if (options.allowReconnectionTime) {
            this.allowReconnectionTime = Math.min(options.allowReconnectionTime, 40);
        }
        if (options.metadata) {
            this.setMetadata(options.metadata);
        }
        this.onMessage('*', (client, type, message) => {
            this.broadcast(type, [client.sessionId, message], { except: client });
        });
    }
    onJoin(client, options = {}) {
        const player = new Player();
        player.connected = true;
        player.sessionId = client.sessionId;
        if (options.name) {
            player.name = options.name;
        }
        this.state.players.set(client.sessionId, player);
    }
    async onLeave(client, consented) {
        if (this.allowReconnectionTime > 0) {
            const player = this.state.players.get(client.sessionId);
            player.connected = false;
            try {
                if (consented) {
                    throw new Error('consented leave');
                }
                await this.allowReconnection(client, this.allowReconnectionTime);
                player.connected = true;
            }
            catch (e) {
                this.state.players.delete(client.sessionId);
            }
        }
    }
}
exports.RelayRoom = RelayRoom;
//# sourceMappingURL=RelayRoom.js.map