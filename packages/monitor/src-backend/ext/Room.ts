//
// Monkey-patch Colyseus' default behaviour
//
import { Room, type Client, type ClientPrivate } from "@colyseus/core";

function getStateSize(room) {
    // TODO: `Serializer<T>` should provide a method for this (e.g. `serializer.hasState()`)
    const hasState = (
      room._serializer.encoder || // schema v3
      room._serializer.state // schema v2
    );
    const fullState = hasState && room._serializer.getFullState();
    return fullState && (fullState.byteLength || fullState.length) || 0;
}

(Room.prototype as any).getAvailableData = function () {
    return {
        clients: this.clients.length,
        maxClients: this.maxClients,
        metadata: this.metadata,
        roomId: this.roomId,
    };
};

(Room.prototype as any).getRoomListData = async function () {
    const stateSize = getStateSize(this);
    const elapsedTime = this.clock.elapsedTime;
    const locked = this.locked;
    const data = this.getAvailableData();

    return { ...data, locked, elapsedTime, stateSize };
};

// longer strings (e.g. base64 blobs) are replaced so polling a big state stays cheap
const MAX_STRING_LENGTH = 1024;

function formatLength(length: number) {
    return (length >= 1024 * 1024)
        ? `${(length / 1024 / 1024).toFixed(1)} MB`
        : `${(length / 1024).toFixed(1)} KB`;
}

function pruneLargeStrings(value: any, path: (string | number)[], truncated: string[]): any {
    if (typeof value === 'string') {
        if (value.length <= MAX_STRING_LENGTH) { return value; }
        truncated.push(JSON.stringify(path));
        return `‹${formatLength(value.length)} string, truncated›`;
    }
    if (value === null || typeof value !== 'object') { return value; }
    if (typeof value.toJSON === 'function') {
        return pruneLargeStrings(value.toJSON(), path, truncated);
    }
    if (Array.isArray(value)) {
        return value.map((item, i) => pruneLargeStrings(item, [...path, i], truncated));
    }
    const pruned: any = {};
    for (const key in value) {
        pruned[key] = pruneLargeStrings(value[key], [...path, key], truncated);
    }
    return pruned;
}

(Room.prototype as any).getInspectData = async function (includeState: boolean = false) {
    const stateSize = getStateSize(this);
    const roomElapsedTime = this.clock.elapsedTime;

    const data = this.getAvailableData();
    const clients = this.clients.map((client: Client & ClientPrivate) => ({
        sessionId: client.sessionId,
        elapsedTime: roomElapsedTime - client._joinedAt
    }));
    const locked = this.locked;

    if (!includeState) {
        return { ...data, locked, clients, stateSize };
    }

    // paths are JSON-encoded so the panel can refuse edits on placeholders
    const truncated: string[] = [];
    const state = pruneLargeStrings(this.state ?? {}, [], truncated);

    return { ...data, locked, clients, state, truncated, stateSize };
};

// Actions
(Room.prototype as any)._forceClientDisconnect = async function (sessionId) {
    for (let i = 0; i < this.clients.length; i++) {
        if (this.clients[i].sessionId === sessionId) {
            this.clients[i].leave();
            break;
        }
    }
};

(Room.prototype as any)._sendMessageToClient = async function (sessionId, type, data) {
    for (let i = 0; i < this.clients.length; i++) {
        if (this.clients[i].sessionId === sessionId) {
            this.clients[i].send(type, data);
            break;
        }
    }
};

function getChild(parent: any, key: string | number) {
    if (typeof parent.at === 'function' && typeof key === 'number') {
        return parent.at(key);
    }
    if (typeof parent.get === 'function') {
        return parent.get(String(key));
    }
    return parent[key];
}

(Room.prototype as any)._editStateProperty = async function (path: (string | number)[], value: any) {
    let current = this.state;
    for (let i = 0; i < path.length - 1; i++) {
        if (current === null || current === undefined) return;
        current = getChild(current, path[i]);
    }
    if (current === null || current === undefined) return;
    const property = path[path.length - 1];
    if (typeof current.set === 'function') {
        current.set(String(property), value);
    } else {
        current[property] = value;
    }
};

(Room.prototype as any)._deleteStateProperty = async function (path: (string | number)[]) {
    let current = this.state;
    for (let i = 0; i < path.length - 1; i++) {
        if (current === null || current === undefined) return;
        current = getChild(current, path[i]);
    }
    if (current === null || current === undefined) return;
    const property = path[path.length - 1];
    if (typeof current.delete === 'function') {
        current.delete(String(property));
    } else {
        current[property] = undefined;
    }
};
