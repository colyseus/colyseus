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
exports.reserveSeatFor = exports.gracefullyShutdown = exports.disconnectAll = exports.getRoomById = exports.createRoom = exports.hasHandler = exports.removeRoomType = exports.defineRoomType = exports.remoteRoomCall = exports.findOneRoomAvailable = exports.query = exports.joinById = exports.join = exports.create = exports.joinOrCreate = exports.setup = exports.driver = exports.presence = exports.processId = exports.controller = void 0;
const Protocol_1 = require("./Protocol");
const IPC_1 = require("./IPC");
const Utils_1 = require("./Utils");
const RegisteredHandler_1 = require("./matchmaker/RegisteredHandler");
const Room_1 = require("./Room");
const LocalPresence_1 = require("./presence/LocalPresence");
const Debug_1 = require("./Debug");
const SeatReservationError_1 = require("./errors/SeatReservationError");
const ServerError_1 = require("./errors/ServerError");
const driver_1 = require("./matchmaker/driver");
const controller = __importStar(require("./matchmaker/controller"));
exports.controller = controller;
const ProxyController = __importStar(require("./controllers/proxyController"));
const DELAY_JOIN_MAX = Number(process.env.DELAY_JOIN_MAX || 1500);
const USE_PROXY = process.env.USE_PROXY || null;
const MY_POD_NAMESPACE = process.env.MY_POD_NAMESPACE || undefined;
const MY_POD_NAME = process.env.MY_POD_NAME || 'proxy-dev';
// const USE_PROXY_PORT = Number(process.env.USE_PROXY_PORT || 2567); 
// const API_KEY = process.env.API_KEY || "LOCALKEY"; NO Need anymore as we setup Redis prefix keys at initi of driver
// const MY_POD_IP = process.env.MY_POD_IP || '0.0.0.0';
let MY_POD_IP = process.env.MY_POD_IP || '0.0.0.0';
const handlers = {};
const rooms = {};
let isGracefullyShuttingDown;
function setup(_presence, _driver, _processId) {
    exports.presence = _presence || new LocalPresence_1.LocalPresence();
    exports.driver = _driver || new driver_1.LocalDriver();
    exports.processId = _processId;
    isGracefullyShuttingDown = false;
    /**
     * Subscribe to remote `handleCreateRoom` calls.
     */
    IPC_1.subscribeIPC(exports.presence, exports.processId, getProcessChannel(), (_, args) => {
        return handleCreateRoom.apply(undefined, args);
    });
    exports.presence.hset(getRoomCountKey(), exports.processId, '0');
}
exports.setup = setup;
function delay(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
/**
 * Join or create into a room and return seat reservation
 */
async function joinOrCreate(roomName, clientOptions = {}) {
    //TODO: FIX ME NOW!
    await delay(100 + (Math.random() * DELAY_JOIN_MAX)); // wait
    return await Utils_1.retry(async () => {
        let room = await findOneRoomAvailable(roomName, clientOptions);
        if (!room) {
            room = await createRoom(roomName, clientOptions);
        }
        return await reserveSeatFor(room, clientOptions);
    }, 5, [SeatReservationError_1.SeatReservationError]);
}
exports.joinOrCreate = joinOrCreate;
/**
 * Create a room and return seat reservation
 */
async function create(roomName, clientOptions = {}) {
    const room = await createRoom(roomName, clientOptions);
    return reserveSeatFor(room, clientOptions);
}
exports.create = create;
/**
 * Join a room and return seat reservation
 */
async function join(roomName, clientOptions = {}) {
    return await Utils_1.retry(async () => {
        const room = await findOneRoomAvailable(roomName, clientOptions);
        if (!room) {
            throw new ServerError_1.ServerError(Protocol_1.ErrorCode.MATCHMAKE_INVALID_CRITERIA, `no rooms found with provided criteria`);
        }
        return reserveSeatFor(room, clientOptions);
    });
}
exports.join = join;
/**
 * Join a room by id and return seat reservation
 */
async function joinById(roomId, clientOptions = {}) {
    const room = await exports.driver.findOne({ roomId });
    if (room) {
        const rejoinSessionId = clientOptions.sessionId;
        if (rejoinSessionId) {
            // handle re-connection!
            const hasReservedSeat = await remoteRoomCall(room.roomId, 'hasReservedSeat', [rejoinSessionId]);
            if (hasReservedSeat) {
                return { room, sessionId: rejoinSessionId };
            }
            else {
                throw new ServerError_1.ServerError(Protocol_1.ErrorCode.MATCHMAKE_EXPIRED, `session expired: ${rejoinSessionId}`);
            }
        }
        else if (!room.locked) {
            return reserveSeatFor(room, clientOptions);
        }
        else {
            throw new ServerError_1.ServerError(Protocol_1.ErrorCode.MATCHMAKE_INVALID_ROOM_ID, `room "${roomId}" is locked`);
        }
    }
    else {
        throw new ServerError_1.ServerError(Protocol_1.ErrorCode.MATCHMAKE_INVALID_ROOM_ID, `room "${roomId}" not found`);
    }
}
exports.joinById = joinById;
/**
 * Perform a query for all cached rooms
 */
async function query(conditions = {}) {
    return await exports.driver.find(conditions);
}
exports.query = query;
/**
 * Find for a public and unlocked room available
 */
async function findOneRoomAvailable(roomName, clientOptions) {
    return await awaitRoomAvailable(roomName, async () => {
        const handler = handlers[roomName];
        if (!handler) {
            throw new ServerError_1.ServerError(Protocol_1.ErrorCode.MATCHMAKE_NO_HANDLER, `provided room name "${roomName}" not defined`);
        }
        const roomQuery = exports.driver.findOne({
            locked: false,
            name: roomName,
            private: false,
            ...handler.getFilterOptions(clientOptions),
        });
        if (handler.sortOptions) {
            roomQuery.sort(handler.sortOptions);
        }
        return await roomQuery;
    });
}
exports.findOneRoomAvailable = findOneRoomAvailable;
/**
 * Call a method or return a property on a remote room.
 */
async function remoteRoomCall(roomId, method, args, rejectionTimeout = Utils_1.REMOTE_ROOM_SHORT_TIMEOUT) {
    const room = rooms[roomId];
    if (!room) {
        try {
            return await IPC_1.requestFromIPC(exports.presence, getRoomChannel(roomId), method, args);
        }
        catch (e) {
            const request = `${method}${args && ' with args ' + JSON.stringify(args) || ''}`;
            throw new ServerError_1.ServerError(Protocol_1.ErrorCode.MATCHMAKE_UNHANDLED, `remote room (${roomId}) timed out, requesting "${request}". (${rejectionTimeout}ms exceeded)`);
        }
    }
    else {
        return (!args && typeof (room[method]) !== 'function')
            ? room[method]
            : (await room[method].apply(room, args));
    }
}
exports.remoteRoomCall = remoteRoomCall;
function defineRoomType(name, klass, defaultOptions) {
    const registeredHandler = new RegisteredHandler_1.RegisteredHandler(klass, defaultOptions);
    handlers[name] = registeredHandler;
    cleanupStaleRooms(name);
    return registeredHandler;
}
exports.defineRoomType = defineRoomType;
function removeRoomType(name) {
    delete handlers[name];
    cleanupStaleRooms(name);
}
exports.removeRoomType = removeRoomType;
function hasHandler(name) {
    return handlers[name] !== undefined;
}
exports.hasHandler = hasHandler;
/**
 * Create a room
 */
async function createRoom(roomName, clientOptions) {
    const roomsSpawnedByProcessId = await exports.presence.hgetall(getRoomCountKey());
    const processIdWithFewerRooms = (Object.keys(roomsSpawnedByProcessId).sort((p1, p2) => {
        return (Number(roomsSpawnedByProcessId[p1]) > Number(roomsSpawnedByProcessId[p2]))
            ? 1
            : -1;
    })[0]) || exports.processId;
    if (processIdWithFewerRooms === exports.processId) {
        // create the room on this process!
        return await handleCreateRoom(roomName, clientOptions);
    }
    else {
        // ask other process to create the room!
        let room;
        try {
            room = await IPC_1.requestFromIPC(exports.presence, getProcessChannel(processIdWithFewerRooms), undefined, [roomName, clientOptions], Utils_1.REMOTE_ROOM_SHORT_TIMEOUT);
        }
        catch (e) {
            // if other process failed to respond, create the room on this process
            Debug_1.debugAndPrintError(e);
            room = await handleCreateRoom(roomName, clientOptions);
        }
        return room;
    }
}
exports.createRoom = createRoom;
async function handleCreateRoom(roomName, clientOptions) {
    const registeredHandler = handlers[roomName];
    if (!registeredHandler) {
        throw new ServerError_1.ServerError(Protocol_1.ErrorCode.MATCHMAKE_NO_HANDLER, `provided room name "${roomName}" not defined`);
    }
    const room = new registeredHandler.klass();
    // set room public attributes
    room.roomId = Utils_1.generateId();
    room.roomName = roomName;
    room.presence = exports.presence;
    // create a RoomCache reference.
    room.listing = exports.driver.createInstance({
        name: roomName,
        processId: exports.processId,
        ...registeredHandler.getFilterOptions(clientOptions),
    });
    if (room.onCreate) {
        try {
            await room.onCreate(Utils_1.merge({}, clientOptions, registeredHandler.options));
            // increment amount of rooms this process is handling
            exports.presence.hincrby(getRoomCountKey(), exports.processId, 1);
        }
        catch (e) {
            Debug_1.debugAndPrintError(e);
            throw new ServerError_1.ServerError(e.code || Protocol_1.ErrorCode.MATCHMAKE_UNHANDLED, e.message);
        }
    }
    room.internalState = Room_1.RoomInternalState.CREATED;
    room.listing.roomId = room.roomId;
    room.listing.maxClients = room.maxClients;
    room.listing.serverName = MY_POD_NAME;
    room.listing.serverIP = MY_POD_IP;
    room.listing.namespace = MY_POD_NAMESPACE;
    // imediatelly ask client to join the room
    Debug_1.debugMatchMaking('spawning \'%s\', roomId: %s, processId: %s', roomName, room.roomId, exports.processId);
    room._events.on('lock', lockRoom.bind(this, room));
    room._events.on('unlock', unlockRoom.bind(this, room));
    room._events.on('join', onClientJoinRoom.bind(this, room));
    room._events.on('leave', onClientLeaveRoom.bind(this, room));
    room._events.once('dispose', disposeRoom.bind(this, roomName, room));
    room._events.once('disconnect', () => room._events.removeAllListeners());
    //Broadcast to proxy
    await boradcastRoomIdToProxy(room.roomId, true);
    // room always start unlocked
    await createRoomReferences(room, true);
    await room.listing.save();
    registeredHandler.emit('create', room);
    return room.listing;
}
async function boradcastRoomIdToProxy(roomId, addToProxy) {
    if (USE_PROXY == null) {
        // console.log("MATCH MAKING - NOT USING PROXY for Multiple Server Support");
        return;
    }
    ProxyController.sendRoomStateNotice(roomId, addToProxy);
}
function getRoomById(roomId) {
    return rooms[roomId];
}
exports.getRoomById = getRoomById;
/**
 * Disconnects every client on every room in the current process.
 */
function disconnectAll() {
    const promises = [];
    for (const roomId in rooms) {
        if (!rooms.hasOwnProperty(roomId)) {
            continue;
        }
        promises.push(rooms[roomId].disconnect());
    }
    return promises;
}
exports.disconnectAll = disconnectAll;
function gracefullyShutdown() {
    if (isGracefullyShuttingDown) {
        return Promise.reject('already_shutting_down');
    }
    isGracefullyShuttingDown = true;
    Debug_1.debugMatchMaking(`${exports.processId} is shutting down!`);
    // remove processId from room count key
    exports.presence.hdel(getRoomCountKey(), exports.processId);
    // unsubscribe from process id channel
    exports.presence.unsubscribe(getProcessChannel());
    return Promise.all(disconnectAll());
}
exports.gracefullyShutdown = gracefullyShutdown;
/**
 * Reserve a seat for a client in a room
 */
async function reserveSeatFor(room, options) {
    const sessionId = Utils_1.generateId();
    Debug_1.debugMatchMaking('reserving seat. sessionId: \'%s\', roomId: \'%s\', processId: \'%s\'', sessionId, room.roomId, exports.processId);
    let successfulSeatReservation;
    try {
        successfulSeatReservation = await remoteRoomCall(room.roomId, '_reserveSeat', [sessionId, options]);
    }
    catch (e) {
        Debug_1.debugMatchMaking(e);
        successfulSeatReservation = false;
    }
    if (!successfulSeatReservation) {
        throw new SeatReservationError_1.SeatReservationError(`${room.roomId} is already full.`);
    }
    return { room, sessionId };
}
exports.reserveSeatFor = reserveSeatFor;
async function cleanupStaleRooms(roomName) {
    //
    // clean-up possibly stale room ids
    // (ungraceful shutdowns using Redis can result on stale room ids still on memory.)
    //
    const cachedRooms = await exports.driver.find({ name: roomName }, { _id: 1 });
    // remove connecting counts
    await exports.presence.del(getHandlerConcurrencyKey(roomName));
    await Promise.all(cachedRooms.map(async (room) => {
        try {
            // use hardcoded short timeout for cleaning up stale rooms.
            await remoteRoomCall(room.roomId, 'roomId');
        }
        catch (e) {
            Debug_1.debugMatchMaking(`cleaning up stale room '${roomName}', roomId: ${room.roomId}`);
            room.remove();
        }
    }));
}
async function createRoomReferences(room, init = false) {
    rooms[room.roomId] = room;
    if (init) {
        await IPC_1.subscribeIPC(exports.presence, exports.processId, getRoomChannel(room.roomId), (method, args) => {
            return (!args && typeof (room[method]) !== 'function')
                ? room[method]
                : room[method].apply(room, args);
        });
    }
    return true;
}
async function awaitRoomAvailable(roomToJoin, callback) {
    return new Promise(async (resolve, reject) => {
        const concurrencyKey = getHandlerConcurrencyKey(roomToJoin);
        const concurrency = await exports.presence.incr(concurrencyKey) - 1;
        // avoid having too long timeout if 10+ clients ask to join at the same time
        const concurrencyTimeout = Math.min(concurrency * 100, Utils_1.REMOTE_ROOM_SHORT_TIMEOUT);
        if (concurrency > 0) {
            Debug_1.debugMatchMaking('receiving %d concurrent requests for joining \'%s\' (waiting %d ms)', concurrency, roomToJoin, concurrencyTimeout);
        }
        setTimeout(async () => {
            try {
                const result = await callback();
                resolve(result);
            }
            catch (e) {
                reject(e);
            }
            finally {
                await exports.presence.decr(concurrencyKey);
            }
        }, concurrencyTimeout);
    });
}
function onClientJoinRoom(room, client) {
    handlers[room.roomName].emit('join', room, client);
}
function onClientLeaveRoom(room, client, willDispose) {
    handlers[room.roomName].emit('leave', room, client, willDispose);
}
function lockRoom(room) {
    // emit public event on registered handler
    handlers[room.roomName].emit('lock', room);
}
async function unlockRoom(room) {
    if (await createRoomReferences(room)) {
        // emit public event on registered handler
        handlers[room.roomName].emit('unlock', room);
    }
}
async function disposeRoom(roomName, room) {
    Debug_1.debugMatchMaking('disposing \'%s\' (%s) on processId \'%s\'', roomName, room.roomId, exports.processId);
    // decrease amount of rooms this process is handling
    if (!isGracefullyShuttingDown) {
        exports.presence.hincrby(getRoomCountKey(), exports.processId, -1);
    }
    // remove from room listing (already removed if `disconnect()` has been called)
    if (room.internalState !== Room_1.RoomInternalState.DISCONNECTING) {
        await room.listing.remove();
    }
    // emit disposal on registered session handler
    handlers[roomName].emit('dispose', room);
    // remove concurrency key
    exports.presence.del(getHandlerConcurrencyKey(roomName));
    // unsubscribe from remote connections
    exports.presence.unsubscribe(getRoomChannel(room.roomId));
    // remove actual room reference
    delete rooms[room.roomId];
}
//
// Presence keys
//
function getRoomChannel(roomId) {
    return `$${roomId}`;
}
function getHandlerConcurrencyKey(name) {
    return `c:${name}`;
}
function getProcessChannel(id = exports.processId) {
    return `p:${id}`;
}
function getRoomCountKey() {
    return 'roomcount';
}
//# sourceMappingURL=MatchMaker.js.map