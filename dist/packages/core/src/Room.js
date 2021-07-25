"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Room = exports.RoomInternalState = exports.DEFAULT_SEAT_RESERVATION_TIME = void 0;
const notepack_io_1 = __importDefault(require("notepack.io"));
const schema_1 = require("@colyseus/schema");
const timer_1 = __importDefault(require("@gamestdio/timer"));
const events_1 = require("events");
const NoneSerializer_1 = require("./serializer/NoneSerializer");
const SchemaSerializer_1 = require("./serializer/SchemaSerializer");
const Protocol_1 = require("./Protocol");
const Utils_1 = require("./Utils");
const Debug_1 = require("./Debug");
const ServerError_1 = require("./errors/ServerError");
const Transport_1 = require("./Transport");
const DEFAULT_PATCH_RATE = 1000 / 20; // 20fps (50ms)
const DEFAULT_SIMULATION_INTERVAL = 1000 / 60; // 60fps (16.66ms)
const noneSerializer = new NoneSerializer_1.NoneSerializer();
exports.DEFAULT_SEAT_RESERVATION_TIME = Number(process.env.COLYSEUS_SEAT_RESERVATION_TIME || 15);
var RoomInternalState;
(function (RoomInternalState) {
    RoomInternalState[RoomInternalState["CREATING"] = 0] = "CREATING";
    RoomInternalState[RoomInternalState["CREATED"] = 1] = "CREATED";
    RoomInternalState[RoomInternalState["DISCONNECTING"] = 2] = "DISCONNECTING";
})(RoomInternalState = exports.RoomInternalState || (exports.RoomInternalState = {}));
class Room {
    constructor(presence) {
        this.clock = new timer_1.default();
        this.maxClients = Infinity;
        this.patchRate = DEFAULT_PATCH_RATE;
        this.autoDispose = true;
        this.clients = [];
        this.internalState = RoomInternalState.CREATING;
        /** @internal */
        this._events = new events_1.EventEmitter();
        // seat reservation & reconnection
        this.seatReservationTime = exports.DEFAULT_SEAT_RESERVATION_TIME;
        this.reservedSeats = {};
        this.reservedSeatTimeouts = {};
        this.reconnections = {};
        this.onMessageHandlers = {};
        this._serializer = noneSerializer;
        this._afterNextPatchQueue = [];
        this._locked = false;
        this._lockedExplicitly = false;
        this._maxClientsReached = false;
        this.presence = presence;
        this._events.once('dispose', async () => {
            try {
                await this._dispose();
            }
            catch (e) {
                Debug_1.debugAndPrintError(`onDispose error: ${(e && e.message || e || 'promise rejected')}`);
            }
            this._events.emit('disconnect');
        });
        this.setPatchRate(this.patchRate);
    }
    get locked() {
        return this._locked;
    }
    get metadata() {
        return this.listing.metadata;
    }
    onAuth(client, options, request) {
        return true;
    }
    hasReachedMaxClients() {
        return (this.clients.length + Object.keys(this.reservedSeats).length) >= this.maxClients;
    }
    setSeatReservationTime(seconds) {
        this.seatReservationTime = seconds;
        return this;
    }
    hasReservedSeat(sessionId) {
        return this.reservedSeats[sessionId] !== undefined;
    }
    setSimulationInterval(onTickCallback, delay = DEFAULT_SIMULATION_INTERVAL) {
        // clear previous interval in case called setSimulationInterval more than once
        if (this._simulationInterval) {
            clearInterval(this._simulationInterval);
        }
        if (onTickCallback) {
            this._simulationInterval = setInterval(() => {
                this.clock.tick();
                onTickCallback(this.clock.deltaTime);
            }, delay);
        }
    }
    setPatchRate(milliseconds) {
        this.patchRate = milliseconds;
        // clear previous interval in case called setPatchRate more than once
        if (this._patchInterval) {
            clearInterval(this._patchInterval);
            this._patchInterval = undefined;
        }
        if (milliseconds !== null && milliseconds !== 0) {
            this._patchInterval = setInterval(() => this.broadcastPatch(), milliseconds);
        }
    }
    setState(newState) {
        this.clock.start();
        if ('_definition' in newState) {
            this.setSerializer(new SchemaSerializer_1.SchemaSerializer());
        }
        this._serializer.reset(newState);
        this.state = newState;
    }
    setSerializer(serializer) {
        this._serializer = serializer;
    }
    async setMetadata(meta) {
        if (!this.listing.metadata) {
            this.listing.metadata = meta;
        }
        else {
            for (const field in meta) {
                if (!meta.hasOwnProperty(field)) {
                    continue;
                }
                this.listing.metadata[field] = meta[field];
            }
            // `MongooseDriver` workaround: persit metadata mutations
            if ('markModified' in this.listing) {
                this.listing.markModified('metadata');
            }
        }
        if (this.internalState === RoomInternalState.CREATED) {
            await this.listing.save();
        }
    }
    async setPrivate(bool = true) {
        this.listing.private = bool;
        if (this.internalState === RoomInternalState.CREATED) {
            await this.listing.save();
        }
    }
    async lock() {
        // rooms locked internally aren't explicit locks.
        this._lockedExplicitly = (arguments[0] === undefined);
        // skip if already locked.
        if (this._locked) {
            return;
        }
        this._locked = true;
        await this.listing.updateOne({
            $set: { locked: this._locked },
        });
        this._events.emit('lock');
    }
    async unlock() {
        // only internal usage passes arguments to this function.
        if (arguments[0] === undefined) {
            this._lockedExplicitly = false;
        }
        // skip if already locked
        if (!this._locked) {
            return;
        }
        this._locked = false;
        await this.listing.updateOne({
            $set: { locked: this._locked },
        });
        this._events.emit('unlock');
    }
    send(client, messageOrType, messageOrOptions, options) {
        console.warn('DEPRECATION WARNING: use client.send(...) instead of this.send(client, ...)');
        client.send(messageOrType, messageOrOptions, options);
    }
    broadcast(typeOrSchema, messageOrOptions, options) {
        const isSchema = (typeof (typeOrSchema) === 'object');
        const opts = ((isSchema) ? messageOrOptions : options);
        if (opts && opts.afterNextPatch) {
            delete opts.afterNextPatch;
            this._afterNextPatchQueue.push(['broadcast', arguments]);
            return;
        }
        if (isSchema) {
            this.broadcastMessageSchema(typeOrSchema, opts);
        }
        else {
            this.broadcastMessageType(typeOrSchema, messageOrOptions, opts);
        }
    }
    broadcastPatch() {
        if (!this._simulationInterval) {
            this.clock.tick();
        }
        if (!this.state) {
            return false;
        }
        const hasChanges = this._serializer.applyPatches(this.clients, this.state);
        // broadcast messages enqueued for "after patch"
        this._dequeueAfterPatchMessages();
        return hasChanges;
    }
    onMessage(messageType, callback) {
        this.onMessageHandlers[messageType] = callback;
        // returns a method to unbind the callback
        return () => delete this.onMessageHandlers[messageType];
    }
    async disconnect() {
        this.internalState = RoomInternalState.DISCONNECTING;
        await this.listing.remove();
        this.autoDispose = true;
        const delayedDisconnection = new Promise((resolve) => this._events.once('disconnect', () => resolve()));
        for (const reconnection of Object.values(this.reconnections)) {
            reconnection.reject();
        }
        let numClients = this.clients.length;
        if (numClients > 0) {
            // clients may have `async onLeave`, room will be disposed after they're fulfilled
            while (numClients--) {
                this._forciblyCloseClient(this.clients[numClients], Protocol_1.Protocol.WS_CLOSE_CONSENTED);
            }
        }
        else {
            // no clients connected, dispose immediately.
            this._events.emit('dispose');
        }
        return await delayedDisconnection;
    }
    async ['_onJoin'](client, req) {
        const sessionId = client.sessionId;
        if (this.reservedSeatTimeouts[sessionId]) {
            clearTimeout(this.reservedSeatTimeouts[sessionId]);
            delete this.reservedSeatTimeouts[sessionId];
        }
        // clear auto-dispose timeout.
        if (this._autoDisposeTimeout) {
            clearTimeout(this._autoDisposeTimeout);
            this._autoDisposeTimeout = undefined;
        }
        // get seat reservation options and clear it
        const options = this.reservedSeats[sessionId];
        delete this.reservedSeats[sessionId];
        // share "after next patch queue" reference with every client.
        client._afterNextPatchQueue = this._afterNextPatchQueue;
        // bind clean-up callback when client connection closes
        client.ref['onleave'] = this._onLeave.bind(this, client);
        client.ref.once('close', client.ref['onleave']);
        this.clients.push(client);
        const reconnection = this.reconnections[sessionId];
        if (reconnection) {
            reconnection.resolve(client);
        }
        else {
            try {
                client.auth = await this.onAuth(client, options, req);
                if (!client.auth) {
                    throw new ServerError_1.ServerError(Protocol_1.ErrorCode.AUTH_FAILED, 'onAuth failed');
                }
                if (this.onJoin) {
                    await this.onJoin(client, options, client.auth);
                }
            }
            catch (e) {
                Utils_1.spliceOne(this.clients, this.clients.indexOf(client));
                // make sure an error code is provided.
                if (!e.code) {
                    e.code = Protocol_1.ErrorCode.APPLICATION_ERROR;
                }
                throw e;
            }
            finally {
                // remove seat reservation
                delete this.reservedSeats[sessionId];
            }
        }
        // emit 'join' to room handler
        this._events.emit('join', client);
        // allow client to send messages after onJoin has succeeded.
        client.ref.on('message', this._onMessage.bind(this, client));
        // confirm room id that matches the room name requested to join
        client.raw(Protocol_1.getMessageBytes[Protocol_1.Protocol.JOIN_ROOM](this._serializer.id, this._serializer.handshake && this._serializer.handshake()));
    }
    allowReconnection(previousClient, seconds = Infinity) {
        if (this.internalState === RoomInternalState.DISCONNECTING) {
            this._disposeIfEmpty(); // gracefully shutting down
            throw new Error('disconnecting');
        }
        const sessionId = previousClient.sessionId;
        this._reserveSeat(sessionId, true, seconds, true);
        // keep reconnection reference in case the user reconnects into this room.
        const reconnection = new Utils_1.Deferred();
        this.reconnections[sessionId] = reconnection;
        if (seconds !== Infinity) {
            // expire seat reservation after timeout
            this.reservedSeatTimeouts[sessionId] = setTimeout(() => reconnection.reject(false), seconds * 1000);
        }
        const cleanup = () => {
            delete this.reservedSeats[sessionId];
            delete this.reconnections[sessionId];
            delete this.reservedSeatTimeouts[sessionId];
        };
        reconnection.
            then((newClient) => {
            newClient.auth = previousClient.auth;
            previousClient.ref = newClient.ref; // swap "ref" for convenience
            previousClient.state = Transport_1.ClientState.RECONNECTED;
            clearTimeout(this.reservedSeatTimeouts[sessionId]);
            cleanup();
        }).
            catch(() => {
            cleanup();
            this.resetAutoDisposeTimeout();
        });
        return reconnection;
    }
    resetAutoDisposeTimeout(timeoutInSeconds = 1) {
        clearTimeout(this._autoDisposeTimeout);
        if (!this.autoDispose) {
            return;
        }
        this._autoDisposeTimeout = setTimeout(() => {
            this._autoDisposeTimeout = undefined;
            this._disposeIfEmpty();
        }, timeoutInSeconds * 1000);
    }
    broadcastMessageSchema(message, options = {}) {
        const encodedMessage = Protocol_1.getMessageBytes[Protocol_1.Protocol.ROOM_DATA_SCHEMA](message);
        let numClients = this.clients.length;
        while (numClients--) {
            const client = this.clients[numClients];
            if (options.except !== client) {
                client.enqueueRaw(encodedMessage);
            }
        }
    }
    broadcastMessageType(type, message, options = {}) {
        const encodedMessage = Protocol_1.getMessageBytes[Protocol_1.Protocol.ROOM_DATA](type, message);
        let numClients = this.clients.length;
        while (numClients--) {
            const client = this.clients[numClients];
            if (options.except !== client) {
                client.enqueueRaw(encodedMessage);
            }
        }
    }
    sendFullState(client) {
        client.enqueueRaw(Protocol_1.getMessageBytes[Protocol_1.Protocol.ROOM_STATE](this._serializer.getFullState(client)));
    }
    _dequeueAfterPatchMessages() {
        const length = this._afterNextPatchQueue.length;
        if (length > 0) {
            for (let i = 0; i < length; i++) {
                const [target, args] = this._afterNextPatchQueue[i];
                if (target === "broadcast") {
                    this.broadcast.apply(this, args);
                }
                else {
                    target.raw.apply(target, args);
                }
            }
            // new messages may have been added in the meantime,
            // let's splice the ones that have been processed
            this._afterNextPatchQueue.splice(0, length);
        }
    }
    async _reserveSeat(sessionId, joinOptions = true, seconds = this.seatReservationTime, allowReconnection = false) {
        if (!allowReconnection && this.hasReachedMaxClients()) {
            return false;
        }
        this.reservedSeats[sessionId] = joinOptions;
        if (!allowReconnection) {
            await this._incrementClientCount();
            this.reservedSeatTimeouts[sessionId] = setTimeout(async () => {
                delete this.reservedSeats[sessionId];
                delete this.reservedSeatTimeouts[sessionId];
                await this._decrementClientCount();
            }, seconds * 1000);
            this.resetAutoDisposeTimeout(seconds);
        }
        return true;
    }
    _disposeIfEmpty() {
        const willDispose = (this.autoDispose &&
            this._autoDisposeTimeout === undefined &&
            this.clients.length === 0 &&
            Object.keys(this.reservedSeats).length === 0);
        if (willDispose) {
            this._events.emit('dispose');
        }
        return willDispose;
    }
    async _dispose() {
        let userReturnData;
        if (this.onDispose) {
            userReturnData = this.onDispose();
        }
        if (this._patchInterval) {
            clearInterval(this._patchInterval);
            this._patchInterval = undefined;
        }
        if (this._simulationInterval) {
            clearInterval(this._simulationInterval);
            this._simulationInterval = undefined;
        }
        if (this._autoDisposeTimeout) {
            clearInterval(this._autoDisposeTimeout);
            this._autoDisposeTimeout = undefined;
        }
        // clear all timeouts/intervals + force to stop ticking
        this.clock.clear();
        this.clock.stop();
        return await (userReturnData || Promise.resolve());
    }
    _onMessage(client, bytes) {
        // skip if client is on LEAVING state.
        if (client.state === Transport_1.ClientState.LEAVING) {
            return;
        }
        const it = { offset: 0 };
        const code = schema_1.decode.uint8(bytes, it);
        if (!bytes) {
            Debug_1.debugAndPrintError(`${this.roomName} (${this.roomId}), couldn't decode message: ${bytes}`);
            return;
        }
        if (code === Protocol_1.Protocol.ROOM_DATA) {
            const messageType = (schema_1.decode.stringCheck(bytes, it))
                ? schema_1.decode.string(bytes, it)
                : schema_1.decode.number(bytes, it);
            let message;
            try {
                message = (bytes.length > it.offset)
                    ? notepack_io_1.default.decode(bytes.slice(it.offset, bytes.length))
                    : undefined;
            }
            catch (e) {
                Debug_1.debugAndPrintError(e);
                return;
            }
            if (this.onMessageHandlers[messageType]) {
                this.onMessageHandlers[messageType](client, message);
            }
            else if (this.onMessageHandlers['*']) {
                this.onMessageHandlers['*'](client, messageType, message);
            }
            else {
                Debug_1.debugAndPrintError(`onMessage for "${messageType}" not registered.`);
            }
        }
        else if (code === Protocol_1.Protocol.JOIN_ROOM) {
            // join room has been acknowledged by the client
            client.state = Transport_1.ClientState.JOINED;
            // send current state when new client joins the room
            if (this.state) {
                this.sendFullState(client);
            }
            // dequeue messages sent before client has joined effectively (on user-defined `onJoin`)
            if (client._enqueuedMessages.length > 0) {
                client._enqueuedMessages.forEach((enqueued) => client.raw(enqueued));
            }
            delete client._enqueuedMessages;
        }
        else if (code === Protocol_1.Protocol.LEAVE_ROOM) {
            this._forciblyCloseClient(client, Protocol_1.Protocol.WS_CLOSE_CONSENTED);
        }
    }
    _forciblyCloseClient(client, closeCode) {
        // stop receiving messages from this client
        client.ref.removeAllListeners('message');
        // prevent "onLeave" from being called twice if player asks to leave
        client.ref.removeListener('close', client.ref['onleave']);
        // only effectively close connection when "onLeave" is fulfilled
        this._onLeave(client, closeCode).then(() => client.leave(Protocol_1.Protocol.WS_CLOSE_NORMAL));
    }
    async _onLeave(client, code) {
        const success = Utils_1.spliceOne(this.clients, this.clients.indexOf(client));
        // call 'onLeave' method only if the client has been successfully accepted.
        if (success && this.onLeave) {
            try {
                client.state = Transport_1.ClientState.LEAVING;
                await this.onLeave(client, (code === Protocol_1.Protocol.WS_CLOSE_CONSENTED));
            }
            catch (e) {
                Debug_1.debugAndPrintError(`onLeave error: ${(e && e.message || e || 'promise rejected')}`);
            }
        }
        if (client.state !== Transport_1.ClientState.RECONNECTED) {
            // try to dispose immediatelly if client reconnection isn't set up.
            const willDispose = await this._decrementClientCount();
            this._events.emit('leave', client, willDispose);
        }
    }
    async _incrementClientCount() {
        // lock automatically when maxClients is reached
        if (!this._locked && this.hasReachedMaxClients()) {
            this._maxClientsReached = true;
            this.lock.call(this, true);
        }
        await this.listing.updateOne({
            $inc: { clients: 1 },
            $set: { locked: this._locked },
        });
    }
    async _decrementClientCount() {
        const willDispose = this._disposeIfEmpty();
        if (this.internalState === RoomInternalState.DISCONNECTING) {
            return;
        }
        // unlock if room is available for new connections
        if (!willDispose) {
            if (this._maxClientsReached && !this._lockedExplicitly) {
                this._maxClientsReached = false;
                this.unlock.call(this, true);
            }
            // update room listing cache
            await this.listing.updateOne({
                $inc: { clients: -1 },
                $set: { locked: this._locked },
            });
        }
        return willDispose;
    }
}
exports.Room = Room;
//# sourceMappingURL=Room.js.map