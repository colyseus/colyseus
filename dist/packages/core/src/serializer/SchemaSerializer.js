"use strict";
/* tslint:disable:no-string-literal */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchemaSerializer = void 0;
const schema_1 = require("@colyseus/schema");
const Debug_1 = require("../Debug");
const Protocol_1 = require("../Protocol");
const Transport_1 = require("../Transport");
class SchemaSerializer {
    constructor() {
        this.id = 'schema';
        this.useFilters = false;
    }
    reset(newState) {
        this.state = newState;
        this.useFilters = schema_1.hasFilter(newState.constructor);
    }
    getFullState(client) {
        const fullEncodedState = this.state.encodeAll(this.useFilters);
        if (client && this.useFilters) {
            return this.state.applyFilters(client, true);
        }
        else {
            return fullEncodedState;
        }
    }
    applyPatches(clients) {
        const hasChanges = this.state['$changes'].changes.size > 0;
        if (hasChanges) {
            let numClients = clients.length;
            // dump changes for patch debugging
            if (Debug_1.debugPatch.enabled) {
                Debug_1.debugPatch.dumpChanges = schema_1.dumpChanges(this.state);
            }
            // get patch bytes
            const patches = this.state.encode(false, [], this.useFilters);
            if (!this.useFilters) {
                // encode changes once, for all clients
                patches.unshift(Protocol_1.Protocol.ROOM_STATE_PATCH);
                while (numClients--) {
                    const client = clients[numClients];
                    //
                    // FIXME: avoid this check.
                    //
                    if (client.state === Transport_1.ClientState.JOINED) {
                        client.raw(patches);
                    }
                }
            }
            else {
                // encode state multiple times, for each client
                while (numClients--) {
                    const client = clients[numClients];
                    //
                    // FIXME: avoid this check.
                    //
                    if (client.state === Transport_1.ClientState.JOINED) {
                        const filteredPatches = this.state.applyFilters(client);
                        client.raw([Protocol_1.Protocol.ROOM_STATE_PATCH, ...filteredPatches]);
                    }
                }
                this.state.discardAllChanges();
            }
            // debug patches
            if (Debug_1.debugPatch.enabled) {
                Debug_1.debugPatch('%d bytes sent to %d clients, %j', patches.length, clients.length, Debug_1.debugPatch.dumpChanges);
            }
        }
        return hasChanges;
    }
    handshake() {
        /**
         * Cache handshake to avoid encoding it for each client joining
         */
        if (!this.handshakeCache) {
            this.handshakeCache = (this.state && schema_1.Reflection.encode(this.state));
        }
        return this.handshakeCache;
    }
}
exports.SchemaSerializer = SchemaSerializer;
//# sourceMappingURL=SchemaSerializer.js.map