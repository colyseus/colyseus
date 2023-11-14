import { ErrorCode, Protocol } from './Protocol';

import { requestFromIPC, subscribeIPC } from './IPC';

import { Deferred, generateId, merge, REMOTE_ROOM_SHORT_TIMEOUT, retry } from './utils/Utils';
import { isDevMode, cacheRoomHistory, getPreviousProcessId, getRoomRestoreListKey, reloadFromCache } from './utils/DevMode';

import { RegisteredHandler } from './matchmaker/RegisteredHandler';
import { Room, RoomInternalState } from './Room';

import { LocalPresence } from './presence/LocalPresence';
import { Presence } from './presence/Presence';

import { debugAndPrintError, debugMatchMaking } from './Debug';
import { SeatReservationError } from './errors/SeatReservationError';
import { ServerError } from './errors/ServerError';

import { IRoomListingData, MatchMakerDriver, RoomListingData, LocalDriver } from './matchmaker/driver';
import controller from './matchmaker/controller';

import { logger } from './Logger';
import { Client } from './Transport';
import { Type } from './types';
import { getHostname } from "./discovery";

export { MatchMakerDriver, controller };

export type ClientOptions = any;

export interface SeatReservation {
  sessionId: string;
  room: RoomListingData;
  devMode?: boolean;
}

export enum BalanceMode {
  rooms = 1,
  players = 2,
}

const handlers: {[id: string]: RegisteredHandler} = {};
const rooms: {[roomId: string]: Room} = {};

export let publicAddress: string;
export let processId: string;
export let presence: Presence;
export let driver: MatchMakerDriver;

export let isGracefullyShuttingDown: boolean;
export let onReady: Deferred;

//
// tracking of server load
//
let roomCount: number = 0;
let playersCount: number = 0;
let lastLoadUpdated: number = 0;
let lastLoadValue: number = -1;
let balanceMode: BalanceMode = BalanceMode.rooms;

export async function setup(
  _presence?: Presence,
  _driver?: MatchMakerDriver,
  _publicAddress?: string,
  _balanceMode?: BalanceMode,
) {
  onReady = new Deferred();
  presence = _presence || new LocalPresence();
  driver = _driver || new LocalDriver();
  publicAddress = _publicAddress;
  balanceMode = _balanceMode ?? BalanceMode.rooms;

  // devMode: try to retrieve previous processId
  if (isDevMode) { processId = await getPreviousProcessId(await getHostname()); }

  // ensure processId is set
  if (!processId) { processId = generateId(); }

  isGracefullyShuttingDown = false;

  /**
   * Subscribe to remote `handleCreateRoom` calls.
   */
  subscribeIPC(presence, processId, getProcessChannel(), (_, args) => {
    return handleCreateRoom.apply(undefined, args);
  });

  await saveLoadValue();

  if (isDevMode) {
    await reloadFromCache();
  }

  onReady.resolve();
}

/**
 * Join or create into a room and return seat reservation
 */
export async function joinOrCreate(roomName: string, clientOptions: ClientOptions = {}) {
  return await retry<Promise<SeatReservation>>(async () => {
    let room = await findOneRoomAvailable(roomName, clientOptions);

    if (!room) {
      room = await createRoom(roomName, clientOptions);
    }

    return await reserveSeatFor(room, clientOptions);
  }, 5, [SeatReservationError]);
}

/**
 * Create a room and return seat reservation
 */
export async function create(roomName: string, clientOptions: ClientOptions = {}) {
  const room = await createRoom(roomName, clientOptions);
  return reserveSeatFor(room, clientOptions);
}

/**
 * Join a room and return seat reservation
 */
export async function join(roomName: string, clientOptions: ClientOptions = {}) {
  return await retry<Promise<SeatReservation>>(async () => {
    const room = await findOneRoomAvailable(roomName, clientOptions);

    if (!room) {
      throw new ServerError(ErrorCode.MATCHMAKE_INVALID_CRITERIA, `no rooms found with provided criteria`);
    }

    return reserveSeatFor(room, clientOptions);
  });
}

/**
 * Join a room by id and return seat reservation
 */
export async function reconnect(roomId: string, clientOptions: ClientOptions = {}) {
  const room = await driver.findOne({ roomId });
  if (!room) {
    logger.info(`❌ room "${roomId}" has been disposed. Did you missed .allowReconnection()?\n👉 https://docs.colyseus.io/server/room/#allowreconnection-client-seconds`);
    throw new ServerError(ErrorCode.MATCHMAKE_INVALID_ROOM_ID, `room "${roomId}" has been disposed.`);
  }

  // check for reconnection
  const reconnectionToken = clientOptions.reconnectionToken;
  if (!reconnectionToken) { throw new ServerError(ErrorCode.MATCHMAKE_UNHANDLED, `'reconnectionToken' must be provided for reconnection.`); }

  // respond to re-connection!
  const sessionId = await remoteRoomCall(room.roomId, 'checkReconnectionToken', [reconnectionToken]);
  if (sessionId) {
    return { room, sessionId };

  } else {
    logger.info(`❌ reconnection token invalid or expired. Did you missed .allowReconnection()?\n👉 https://docs.colyseus.io/server/room/#allowreconnection-client-seconds`);
    throw new ServerError(ErrorCode.MATCHMAKE_EXPIRED, `reconnection token invalid or expired.`);
  }
}

/**
 * Join a room by id and return client seat reservation. An exception is thrown if a room is not found for roomId.
 *
 * @param roomId - The Id of the specific room instance.
 * @param clientOptions - Options for the client seat reservation (for `onJoin`/`onAuth`)
 *
 * @returns Promise<SeatReservation> - A promise which contains `sessionId` and `RoomListingData`.
 */
export async function joinById(roomId: string, clientOptions: ClientOptions = {}) {
  const room = await driver.findOne({ roomId });

  if (!room) {
    throw new ServerError(ErrorCode.MATCHMAKE_INVALID_ROOM_ID, `room "${roomId}" not found`);

  } else if (room.locked) {
    throw new ServerError(ErrorCode.MATCHMAKE_INVALID_ROOM_ID, `room "${roomId}" is locked`);
  }

  return reserveSeatFor(room, clientOptions);
}

/**
 * Perform a query for all cached rooms
 */
export async function query(conditions: Partial<IRoomListingData> = {}) {
  return await driver.find(conditions);
}

/**
 * Find for a public and unlocked room available.
 *
 * @param roomName - The Id of the specific room.
 * @param clientOptions - Options for the client seat reservation (for `onJoin`/`onAuth`).
 *
 * @returns Promise<RoomListingData> - A promise contaning an object which includes room metadata and configurations.
 */
export async function findOneRoomAvailable(roomName: string, clientOptions: ClientOptions): Promise<RoomListingData> {
  return await awaitRoomAvailable(roomName, async () => {
    const handler = handlers[roomName];
    if (!handler) {
      throw new ServerError( ErrorCode.MATCHMAKE_NO_HANDLER, `provided room name "${roomName}" not defined`);
    }

    const roomQuery = driver.findOne({
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

/**
 * Call a method or return a property on a remote room.
 *
 * @param roomId - The Id of the specific room instance.
 * @param method - Method or attribute to call or retrive.
 * @param args - Array of arguments for the method
 *
 * @returns Promise<any> - Returned value from the called or retrieved method/attribute.
 */
export async function remoteRoomCall<R= any>(
  roomId: string,
  method: string,
  args?: any[],
  rejectionTimeout = REMOTE_ROOM_SHORT_TIMEOUT,
): Promise<R> {
  const room = rooms[roomId];

  if (!room) {
    try {
      return await requestFromIPC<R>(presence, getRoomChannel(roomId), method, args, rejectionTimeout);

    } catch (e) {
      const request = `${method}${args && ' with args ' + JSON.stringify(args) || ''}`;
      throw new ServerError(
        ErrorCode.MATCHMAKE_UNHANDLED,
        `remote room (${roomId}) timed out, requesting "${request}". (${rejectionTimeout}ms exceeded)`,
      );
    }

  } else {
    return (!args && typeof (room[method]) !== 'function')
        ? room[method]
        : (await room[method].apply(room, args && args.map((arg) => JSON.parse(JSON.stringify(arg)))));
  }
}

export function defineRoomType<T extends Type<Room>>(
  name: string,
  klass: T,
  defaultOptions?: Parameters<NonNullable<InstanceType<T>['onCreate']>>[0],
) {
  const registeredHandler = new RegisteredHandler(klass, defaultOptions);

  handlers[name] = registeredHandler;

  if (!isDevMode) {
    cleanupStaleRooms(name);
  }

  return registeredHandler;
}

export function removeRoomType(name: string) {
  delete handlers[name];

  if (!isDevMode) {
    cleanupStaleRooms(name);
  }
}

export function hasHandler(name: string) {
  return handlers[ name ] !== undefined;
}

/**
 * Creates a new room.
 *
 * @param roomName - The identifier you defined on `gameServer.define()`
 * @param clientOptions - Options for `onCreate`
 *
 * @returns Promise<RoomListingData> - A promise contaning an object which includes room metadata and configurations.
 */
export async function createRoom(roomName: string, clientOptions: ClientOptions): Promise<RoomListingData> {
  const roomsSpawnedByProcessId = await presence.hgetall(getLoadKey());

  // a sort is a lot more computational than just finding the min value
  const processIdWithFewerRooms = Object.keys(roomsSpawnedByProcessId).reduce((current, p) => {
    return (!current || Number(roomsSpawnedByProcessId[p]) < Number(roomsSpawnedByProcessId[current])
      ? p
      : current);
  }, undefined) || processId;

  let room: RoomListingData;
  if (processIdWithFewerRooms === processId) {
    // create the room on this process!
    room = await handleCreateRoom(roomName, clientOptions);
  } else {
    // ask other process to create the room!
    try {
      room = await requestFromIPC<RoomListingData>(
        presence,
        getProcessChannel(processIdWithFewerRooms),
        undefined,
        [roomName, clientOptions],
        REMOTE_ROOM_SHORT_TIMEOUT,
      );

    } catch (e) {
      //
      // clean-up possibly stale process from redis.
      // when a process disconnects ungracefully, it may leave its previous processId under "roomcount"
      // if the process is still alive, it will re-add itself shortly after the load-balancer selects it again.
      //
      await presence.hdel(getLoadKey(), processIdWithFewerRooms);

      // if other process failed to respond, create the room on this process
      debugAndPrintError(e);
      room = await handleCreateRoom(roomName, clientOptions);
    }
  }

  if (isDevMode) {
    presence.hset(getRoomRestoreListKey(), room.roomId, JSON.stringify({
      "clientOptions": clientOptions,
      "roomName": roomName,
      "processId": processId
    }));
  }

  return room;
}

export async function handleCreateRoom(roomName: string, clientOptions: ClientOptions, restoringRoomId?: string): Promise<RoomListingData> {
  const registeredHandler = handlers[roomName];

  if (!registeredHandler) {
    throw new ServerError( ErrorCode.MATCHMAKE_NO_HANDLER, `provided room name "${roomName}" not defined`);
  }

  const room = new registeredHandler.klass();

  // set room public attributes
  if (restoringRoomId && isDevMode) {
    room.roomId = restoringRoomId;

  } else {
    room.roomId = generateId();
  }

  room.roomName = roomName;
  room.presence = presence;

  const additionalListingData: any = registeredHandler.getFilterOptions(clientOptions);

  // assign public host
  if (publicAddress) {
    additionalListingData.publicAddress = publicAddress;
  }

  // create a RoomCache reference.
  room.listing = driver.createInstance({
    name: roomName,
    processId,
    ...additionalListingData
  });

  if (room.onCreate) {
    try {
      await room.onCreate(merge({}, clientOptions, registeredHandler.options));

      // increment amount of rooms this process is handling
      roomCount++;
      saveLoadValue();
    } catch (e) {
      debugAndPrintError(e);
      throw new ServerError(
        e.code || ErrorCode.MATCHMAKE_UNHANDLED,
        e.message,
      );
    }
  }

  room['_internalState'] = RoomInternalState.CREATED;

  room.listing.roomId = room.roomId;
  room.listing.maxClients = room.maxClients;

  // imediatelly ask client to join the room
  debugMatchMaking('spawning \'%s\', roomId: %s, processId: %s', roomName, room.roomId, processId);

  room._events.on('lock', lockRoom.bind(this, room));
  room._events.on('unlock', unlockRoom.bind(this, room));
  room._events.on('join', onClientJoinRoom.bind(this, room));
  room._events.on('leave', onClientLeaveRoom.bind(this, room));
  room._events.once('dispose', disposeRoom.bind(this, roomName, room));
  room._events.once('disconnect', () => room._events.removeAllListeners());

  // room always start unlocked
  await createRoomReferences(room, true);
  await room.listing.save();

  registeredHandler.emit('create', room);

  return room.listing;
}

export function getRoomById(roomId: string) {
  return rooms[roomId];
}

/**
 * Disconnects every client on every room in the current process.
 */
export function disconnectAll(closeCode?: number) {
  const promises: Array<Promise<any>> = [];

  for (const roomId in rooms) {
    if (!rooms.hasOwnProperty(roomId)) { continue; }
    promises.push(rooms[roomId].disconnect(closeCode));
  }

  return promises;
}

export async function gracefullyShutdown(): Promise<any> {
  if (isGracefullyShuttingDown) {
    return Promise.reject('already_shutting_down');
  }

  isGracefullyShuttingDown = true;

  debugMatchMaking(`${processId} is shutting down!`);

  if (isDevMode) {
    await cacheRoomHistory(rooms);
  }

  // remove processId from room count key
  presence.hdel(getLoadKey(), processId);

  // unsubscribe from process id channel
  presence.unsubscribe(getProcessChannel());

  return Promise.all(disconnectAll(
    (isDevMode)
      ? Protocol.WS_CLOSE_DEVMODE_RESTART
      : undefined
  ));
}

/**
 * Reserve a seat for a client in a room
 */
export async function reserveSeatFor(room: RoomListingData, options: any) {
  const sessionId: string = generateId();

  debugMatchMaking(
    'reserving seat. sessionId: \'%s\', roomId: \'%s\', processId: \'%s\'',
    sessionId, room.roomId, processId,
  );

  let successfulSeatReservation: boolean;

  try {
    successfulSeatReservation = await remoteRoomCall(room.roomId, '_reserveSeat', [sessionId, options]);

  } catch (e) {
    debugMatchMaking(e);
    successfulSeatReservation = false;
  }

  if (!successfulSeatReservation) {
    throw new SeatReservationError(`${room.roomId} is already full.`);
  }

  const response: SeatReservation = { room, sessionId };

  if (isDevMode) {
    response.devMode = isDevMode;
  }

  return response;
}

async function cleanupStaleRooms(roomName: string) {
  //
  // clean-up possibly stale room ids
  // (ungraceful shutdowns using Redis can result on stale room ids still on memory.)
  //
  const cachedRooms = await driver.find({ name: roomName }, { _id: 1 });

  // remove connecting counts
  await presence.del(getHandlerConcurrencyKey(roomName));

  await Promise.all(cachedRooms.map(async (room) => {
    try {
      // use hardcoded short timeout for cleaning up stale rooms.
      await remoteRoomCall(room.roomId, 'roomId');

    } catch (e) {
      debugMatchMaking(`cleaning up stale room '${roomName}', roomId: ${room.roomId}`);
      room.remove();
    }
  }));
}

async function createRoomReferences(room: Room, init: boolean = false): Promise<boolean> {
  rooms[room.roomId] = room;

  if (init) {
    await subscribeIPC(
      presence,
      processId,
      getRoomChannel(room.roomId),
      (method, args) => {
        return (!args && typeof (room[method]) !== 'function')
          ? room[method]
          : room[method].apply(room, args);
      },
    );
  }

  return true;
}

async function awaitRoomAvailable(roomToJoin: string, callback: Function): Promise<RoomListingData> {
  return new Promise(async (resolve, reject) => {
    const concurrencyKey = getHandlerConcurrencyKey(roomToJoin);
    const concurrency = await presence.incr(concurrencyKey) - 1;

    //
    // avoid having too long timeout if 10+ clients ask to join at the same time
    //
    // TODO: we need a better solution here. either a lock or queue system should be implemented instead.
    // https://github.com/colyseus/colyseus/issues/466
    //
    const concurrencyTimeout = Math.min(concurrency * 100, 500);

    if (concurrency > 0) {
      debugMatchMaking(
        'receiving %d concurrent requests for joining \'%s\' (waiting %d ms)',
        concurrency, roomToJoin, concurrencyTimeout,
      );
    }

    setTimeout(async () => {
      try {
        const result = await callback();
        resolve(result);

      } catch (e) {
        reject(e);

      } finally {
        await presence.decr(concurrencyKey);
      }
    }, concurrencyTimeout);
  });
}

function onClientJoinRoom(room: Room, client: Client) {
  // increment global CCU
  playersCount++;
  presence.incr(getGlobalCCUCounter());
  saveLoadValue();
  handlers[room.roomName].emit('join', room, client);
}

function onClientLeaveRoom(room: Room, client: Client, willDispose: boolean) {
  // decrement global CCU
  playersCount--;
  presence.decr(getGlobalCCUCounter());
  saveLoadValue();
  handlers[room.roomName].emit('leave', room, client, willDispose);
}

function lockRoom(room: Room): void {
  // emit public event on registered handler
  handlers[room.roomName].emit('lock', room);
}

async function unlockRoom(room: Room) {
  if (await createRoomReferences(room)) {
    // emit public event on registered handler
    handlers[room.roomName].emit('unlock', room);
  }
}

async function disposeRoom(roomName: string, room: Room) {
  debugMatchMaking('disposing \'%s\' (%s) on processId \'%s\'', roomName, room.roomId, processId);

  roomCount--;
  // decrease amount of rooms this process is handling
  if (!isGracefullyShuttingDown) {
    saveLoadValue();

    // remove from devMode restore list
    if (isDevMode) {
      await presence.hdel(getRoomRestoreListKey(), room.roomId);
    }
  }

  // emit disposal on registered session handler
  handlers[roomName].emit('dispose', room);

  // remove concurrency key
  presence.del(getHandlerConcurrencyKey(roomName));

  // unsubscribe from remote connections
  presence.unsubscribe(getRoomChannel(room.roomId));

  // remove actual room reference
  delete rooms[room.roomId];
}

//
// functions to handle load
//

// save our load value to redis for distributing rooms across servers.
async function saveLoadValue() {
  let load: number = balanceMode === BalanceMode.players ? playersCount : roomCount;

  // if load unchanged, don't save
  if (load === lastLoadValue) return;

  // players count changes A LOT so limit updates to 1 per second
  if (balanceMode === BalanceMode.players) {
    const now = Date.now();
    if (now - lastLoadUpdated < 1000) {
      return;
    }
  }

  lastLoadUpdated = Date.now();
  lastLoadValue = load;
  await presence.hset(getLoadKey(), processId, load.toString());
}

//
// Presence keys
//

// maintain this export for backward compatibility, but it is no
// longer used internally.
export function getRoomCountKey() {
  return 'roomcount';
}

function getLoadKey() {
  // maintain 'roomcount' keys for room mode, for backward compatibility
  // another those that might use roomcount.
  return balanceMode === BalanceMode.players ? 'loadcount' : 'roomcount';
}

function getRoomChannel(roomId: string) {
  return `$${roomId}`;
}

function getHandlerConcurrencyKey(name: string) {
  return `c:${name}`;
}

function getProcessChannel(id: string = processId) {
  return `p:${id}`;
}

function getGlobalCCUCounter() {
  return "_ccu";
}
