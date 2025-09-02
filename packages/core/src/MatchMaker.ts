import { EventEmitter } from 'events';
import { ErrorCode, Protocol } from './Protocol.js';

import { requestFromIPC, subscribeIPC, subscribeWithTimeout } from './IPC.js';

import { Deferred, generateId, merge, retry, MAX_CONCURRENT_CREATE_ROOM_WAIT_TIME, REMOTE_ROOM_SHORT_TIMEOUT } from './utils/Utils.js';
import { isDevMode, cacheRoomHistory, getPreviousProcessId, getRoomRestoreListKey, reloadFromCache } from './utils/DevMode.js';

import { RegisteredHandler } from './matchmaker/RegisteredHandler.js';
import { Room, RoomInternalState } from './Room.js';

import { LocalPresence } from './presence/LocalPresence.js';
import { Presence } from './presence/Presence.js';

import { debugAndPrintError, debugMatchMaking } from './Debug.js';
import { SeatReservationError } from './errors/SeatReservationError.js';
import { ServerError } from './errors/ServerError.js';

import { IRoomCache, LocalDriver, MatchMakerDriver, SortOptions } from './matchmaker/driver/local/LocalDriver.js';
import controller from './matchmaker/controller.js';
import * as stats from './Stats.js';

import { logger } from './Logger.js';
import { AuthContext, Client } from './Transport.js';
import { Type } from './utils/types.js';
import { getHostname } from './discovery/index.js';
import { getLockId } from './matchmaker/driver/api.js';

export { controller, stats, type MatchMakerDriver };

export type ClientOptions = any;
export type SelectProcessIdCallback = (roomName: string, clientOptions: ClientOptions) => Promise<string>;

export interface SeatReservation {
  sessionId: string;
  room: IRoomCache;
  devMode?: boolean;
}

const handlers: {[id: string]: RegisteredHandler} = {};
const rooms: {[roomId: string]: Room} = {};
const events = new EventEmitter();

export let publicAddress: string;
export let processId: string;
export let presence: Presence;
export let driver: MatchMakerDriver;
export let selectProcessIdToCreateRoom: SelectProcessIdCallback;

/**
 * Whether health checks are enabled or not. (default: true)
 *
 * Health checks are automatically performed on theses scenarios:
 * - At startup, to check for leftover/invalid processId's
 * - When a remote room creation request times out
 * - When a remote seat reservation request times out
 */
let enableHealthChecks: boolean = true;
export function setHealthChecksEnabled(value: boolean) {
  enableHealthChecks = value;
}

export let onReady: Deferred = new Deferred(); // onReady needs to be immediately available to @colyseus/auth integration.

export enum MatchMakerState {
  INITIALIZING,
  READY,
  SHUTTING_DOWN
}

/**
 * Internal MatchMaker state
 */
export let state: MatchMakerState;

/**
 * @private
 */
export async function setup(
  _presence?: Presence,
  _driver?: MatchMakerDriver,
  _publicAddress?: string,
  _selectProcessIdToCreateRoom?: SelectProcessIdCallback,
) {
  if (onReady === undefined) {
    //
    // for testing purposes only: onReady is turned into undefined on shutdown
    // (needs refactoring.)
    //
    onReady = new Deferred();
  }

  state = MatchMakerState.INITIALIZING;

  presence = _presence || new LocalPresence();

  driver = _driver || new LocalDriver();
  publicAddress = _publicAddress;

  stats.reset(false);

  // devMode: try to retrieve previous processId
  if (isDevMode) { processId = await getPreviousProcessId(await getHostname()); }

  // ensure processId is set
  if (!processId) { processId = generateId(); }

  /**
   * Define default `assignRoomToProcessId` method.
   * By default, return the process with least amount of rooms created
   */
  selectProcessIdToCreateRoom = _selectProcessIdToCreateRoom || async function () {
    return (await stats.fetchAll())
      .sort((p1, p2) => p1.roomCount > p2.roomCount ? 1 : -1)[0]?.processId || processId;
  };

  onReady.resolve();
}

/**
 * - Accept receiving remote room creation requests
 * - Check for leftover/invalid processId's on startup
 * @private
 */
export async function accept() {
  await onReady; // make sure "processId" is available

  /**
   * Process-level subscription
   * - handle remote process healthcheck
   * - handle remote room creation
   */
  await subscribeIPC(presence, getProcessChannel(), (method, args) => {
    if (method === 'healthcheck') {
      // health check for this processId
      return true;

    } else {
      // handle room creation
      return handleCreateRoom.apply(undefined, args);
    }
  });

  /**
   * Check for leftover/invalid processId's on startup
   */
  if (enableHealthChecks) {
    await healthCheckAllProcesses();

    /*
     * persist processId every 1 minute
     *
     * FIXME: this is a workaround in case this `processId` gets excluded
     * (`stats.excludeProcess()`) by mistake due to health-check failure
     */
    stats.setAutoPersistInterval();
  }

  state = MatchMakerState.READY;

  await stats.persist();

  if (isDevMode) {
    await reloadFromCache();
  }
}

/**
 * Join or create into a room and return seat reservation
 */
export async function joinOrCreate(roomName: string, clientOptions: ClientOptions = {}, authContext?: AuthContext) {
  return await retry<Promise<SeatReservation>>(async () => {
    const authData = await callOnAuth(roomName, clientOptions, authContext);
    let room: IRoomCache = await findOneRoomAvailable(roomName, clientOptions);

    if (!room) {
      const handler = getHandler(roomName);
      const filterOptions = handler.getFilterOptions(clientOptions);
      const concurrencyKey = getLockId(filterOptions);

      //
      // Prevent multiple rooms of same filter from being created concurrently
      //
      await concurrentJoinOrCreateRoomLock(handler, concurrencyKey, async (roomId?: string) => {
        if (roomId) {
          room = await driver.findOne({ roomId })
        }

        // If the room is not found or is already locked, try to find a new one
        if (!room || room.locked) {
          room = await findOneRoomAvailable(roomName, clientOptions);
        }

        if (!room) {
          //
          // TODO [?]
          //    should we expose the "creator" auth data of the room during `onCreate()`?
          //    it would be useful, though it could be accessed via `onJoin()` for now.
          //
          room = await createRoom(roomName, clientOptions);

          // Notify waiting concurrent requests about the new room
          presence.publish(`concurrent:${handler.name}:${concurrencyKey}`, room.roomId);
        }

        return room;
      });
    }

    return await reserveSeatFor(room, clientOptions, authData);
  }, 5, [SeatReservationError]);
}

/**
 * Create a room and return seat reservation
 */
export async function create(roomName: string, clientOptions: ClientOptions = {}, authContext?: AuthContext) {
  const authData = await callOnAuth(roomName, clientOptions, authContext);
  const room = await createRoom(roomName, clientOptions);
  return reserveSeatFor(room, clientOptions, authData);
}

/**
 * Join a room and return seat reservation
 */
export async function join(roomName: string, clientOptions: ClientOptions = {}, authContext?: AuthContext) {
  return await retry<Promise<SeatReservation>>(async () => {
    const authData = await callOnAuth(roomName, clientOptions, authContext);
    const room = await findOneRoomAvailable(roomName, clientOptions);

    if (!room) {
      throw new ServerError(ErrorCode.MATCHMAKE_INVALID_CRITERIA, `no rooms found with provided criteria`);
    }

    return reserveSeatFor(room, clientOptions, authData);
  });
}

/**
 * Join a room by id and return seat reservation
 */
export async function reconnect(roomId: string, clientOptions: ClientOptions = {}) {
  const room = await driver.findOne({ roomId });
  if (!room) {
    // TODO: support a "logLevel" out of the box?
    if (process.env.NODE_ENV !== 'production') {
      logger.info(`❌ room "${roomId}" has been disposed. Did you miss .allowReconnection()?\n👉 https://docs.colyseus.io/server/room/#allowreconnection-client-seconds`);
    }

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
    // TODO: support a "logLevel" out of the box?
    if (process.env.NODE_ENV !== 'production') {
      logger.info(`❌ reconnection token invalid or expired. Did you miss .allowReconnection()?\n👉 https://docs.colyseus.io/server/room/#allowreconnection-client-seconds`);
    }
    throw new ServerError(ErrorCode.MATCHMAKE_EXPIRED, `reconnection token invalid or expired.`);
  }
}

/**
 * Join a room by id and return client seat reservation. An exception is thrown if a room is not found for roomId.
 *
 * @param roomId - The Id of the specific room instance.
 * @param clientOptions - Options for the client seat reservation (for `onJoin`/`onAuth`)
 * @param authContext - Optional authentication token
 *
 * @returns Promise<SeatReservation> - A promise which contains `sessionId` and `IRoomCache`.
 */
export async function joinById(roomId: string, clientOptions: ClientOptions = {}, authContext?: AuthContext) {
  const room = await driver.findOne({ roomId });

  if (!room) {
    throw new ServerError(ErrorCode.MATCHMAKE_INVALID_ROOM_ID, `room "${roomId}" not found`);

  } else if (room.locked) {
    throw new ServerError(ErrorCode.MATCHMAKE_INVALID_ROOM_ID, `room "${roomId}" is locked`);
  }

  const authData = await callOnAuth(room.name, clientOptions, authContext);

  return reserveSeatFor(room, clientOptions, authData);
}

/**
 * Perform a query for all cached rooms
 */
export async function query(conditions: Partial<IRoomCache> = {}, sortOptions?: SortOptions) {
  return await driver.query(conditions, sortOptions);
}

/**
 * Find for a public and unlocked room available.
 *
 * @param roomName - The Id of the specific room.
 * @param filterOptions - Filter options.
 * @param sortOptions - Sorting options.
 *
 * @returns Promise<IRoomCache> - A promise contaning an object which includes room metadata and configurations.
 */
export async function findOneRoomAvailable(
  roomName: string,
  filterOptions: ClientOptions,
  additionalSortOptions?: SortOptions,
) {
  const handler = getHandler(roomName);
  const sortOptions = Object.assign({}, handler.sortOptions ?? {});

  if (additionalSortOptions) {
    Object.assign(sortOptions, additionalSortOptions);
  }

  return await driver.findOne({
    locked: false,
    name: roomName,
    private: false,
    ...handler.getFilterOptions(filterOptions),
  }, sortOptions);
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

      //
      // the room cache from an unavailable process might've been used here.
      // perform a health-check on the process before proceeding.
      // (this is a broken state when a process wasn't gracefully shut down)
      //
      if (method === '_reserveSeat' && e.message === "ipc_timeout") {
        throw e;
      }

      // TODO: for 1.0, consider always throwing previous error directly.

      const request = `${method}${args && ' with args ' + JSON.stringify(args) || ''}`;
      throw new ServerError(
        ErrorCode.MATCHMAKE_UNHANDLED,
        `remote room (${roomId}) timed out, requesting "${request}". (${rejectionTimeout}ms exceeded)`,
      );
    }

  } else {
    return (!args && typeof (room[method]) !== 'function')
        ? room[method]
        : (await room[method].apply(room, args && JSON.parse(JSON.stringify(args))));
  }
}

export function defineRoomType<T extends Type<Room>>(
  roomName: string,
  klass: T,
  defaultOptions?: Parameters<NonNullable<InstanceType<T>['onCreate']>>[0],
) {
  const registeredHandler = new RegisteredHandler(roomName, klass, defaultOptions);

  handlers[roomName] = registeredHandler;

  if (klass.prototype['onAuth'] !== Room.prototype['onAuth']) {
    // TODO: soft-deprecate instance level `onAuth` on 0.16
    // logger.warn("DEPRECATION WARNING: onAuth() at the instance level will be deprecated soon. Please use static onAuth() instead.");

    if (klass['onAuth'] !== Room['onAuth']) {
      logger.info(`❌ "${roomName}"'s onAuth() defined at the instance level will be ignored.`);
    }
  }

  return registeredHandler;
}

export function removeRoomType(roomName: string) {
  delete handlers[roomName];
}

// TODO: legacy; remove me on 1.0
export function hasHandler(roomName: string) {
  logger.warn("hasHandler() is deprecated. Use getHandler() instead.");
  return handlers[roomName] !== undefined;
}

export function getHandler(roomName: string) {
  const handler = handlers[roomName];

  if (!handler) {
    throw new ServerError(ErrorCode.MATCHMAKE_NO_HANDLER, `provided room name "${roomName}" not defined`);
  }

  return handler;
}

export function getRoomClass(roomName: string): Type<Room> {
  return handlers[roomName]?.klass;
}


/**
 * Creates a new room.
 *
 * @param roomName - The identifier you defined on `gameServer.define()`
 * @param clientOptions - Options for `onCreate`
 *
 * @returns Promise<IRoomCache> - A promise contaning an object which includes room metadata and configurations.
 */
export async function createRoom(roomName: string, clientOptions: ClientOptions): Promise<IRoomCache> {
  //
  // - select a process to create the room
  // - use local processId if MatchMaker is not ready yet
  //
  const selectedProcessId = (state === MatchMakerState.READY)
    ? await selectProcessIdToCreateRoom(roomName, clientOptions)
    : processId;

  let room: IRoomCache;
  if (selectedProcessId === undefined) {

    if (isDevMode && processId === undefined) {
      //
      // WORKAROUND: wait for processId to be available
      // TODO: Remove this check on 1.0
      //
      // - This is a workaround when using matchMaker.createRoom() before the processId is available.
      // - We need to use top-level await to retrieve processId
      //
      await onReady;
      return createRoom(roomName, clientOptions);

    } else {
      throw new ServerError(ErrorCode.MATCHMAKE_UNHANDLED, `no processId available to create room ${roomName}`);
    }

  } else if (selectedProcessId === processId) {
    // create the room on this process!
    room = await handleCreateRoom(roomName, clientOptions);

  } else {
    // ask other process to create the room!
    try {
      room = await requestFromIPC<IRoomCache>(
        presence,
        getProcessChannel(selectedProcessId),
        undefined,
        [roomName, clientOptions],
        REMOTE_ROOM_SHORT_TIMEOUT,
      );

    } catch (e) {
      if (e.message === "ipc_timeout") {
        debugAndPrintError(`${e.message}: create room request timed out for ${roomName} on processId ${selectedProcessId}.`);

        //
        // clean-up possibly stale process from redis.
        // when a process disconnects ungracefully, it may leave its previous processId under "roomcount"
        // if the process is still alive, it will re-add itself shortly after the load-balancer selects it again.
        //
        if (enableHealthChecks) {
          await stats.excludeProcess(selectedProcessId);
        }

        // if other process failed to respond, create the room on this process
        room = await handleCreateRoom(roomName, clientOptions);

      } else {
        // re-throw intentional exception thrown during remote onCreate()
        throw e;
      }
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

export async function handleCreateRoom(roomName: string, clientOptions: ClientOptions, restoringRoomId?: string): Promise<IRoomCache> {
  const handler = getHandler(roomName);
  const room = new handler.klass();

  // set room public attributes
  if (restoringRoomId && isDevMode) {
    room.roomId = restoringRoomId;

  } else {
    room.roomId = generateId();
  }

  //
  // Initialize .state (if set).
  //
  // Define getters and setters for:
  //   - autoDispose
  //   - patchRate
  //
  room['__init']();

  room.roomName = roomName;
  room.presence = presence;

  const additionalListingData: any = handler.getFilterOptions(clientOptions);

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
      await room.onCreate(merge({}, clientOptions, handler.options));

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

  // increment amount of rooms this process is handling
  stats.local.roomCount++;
  stats.persist();

  room._events.on('lock', lockRoom.bind(this, room));
  room._events.on('unlock', unlockRoom.bind(this, room));
  room._events.on('join', onClientJoinRoom.bind(this, room));
  room._events.on('leave', onClientLeaveRoom.bind(this, room));
  room._events.on('visibility-change', onVisibilityChange.bind(this, room));
  room._events.once('dispose', disposeRoom.bind(this, roomName, room));

  // when disconnect()'ing, keep only join/leave events for stat counting
  room._events.once('disconnect', () => {
    room._events.removeAllListeners('lock');
    room._events.removeAllListeners('unlock');
    room._events.removeAllListeners('visibility-change');
    room._events.removeAllListeners('dispose');

    //
    // emit "no active rooms" event when there are no more rooms in this process
    // (used during graceful shutdown)
    //
    if (stats.local.roomCount <= 0) {
      events.emit('no-active-rooms');
    }
  });

  // room always start unlocked
  await createRoomReferences(room, true);

  // persist room data only if match-making is enabled
  if (state !== MatchMakerState.SHUTTING_DOWN) {
    await room.listing.save();
  }

  handler.emit('create', room);

  return room.listing;
}

/**
 * Get room data by roomId.
 * This method does not return the actual room instance, use `getLocalRoomById` for that.
 */
export function getRoomById(roomId: string) {
  return driver.findOne({ roomId });
}

/**
 * Get local room instance by roomId. (Can return "undefined" if the room is not available on this process)
 */
export function getLocalRoomById(roomId: string) {
  return rooms[roomId];
}

/**
 * Disconnects every client on every room in the current process.
 */
export function disconnectAll(closeCode?: number) {
  const promises: Array<Promise<any>> = [];

  for (const roomId in rooms) {
    if (!rooms.hasOwnProperty(roomId)) {
      continue;
    }

    promises.push(rooms[roomId].disconnect(closeCode));
  }

  return promises;
}

async function lockAndDisposeAll(): Promise<any> {
  // remove processId from room count key
  // (stops accepting new rooms on this process)
  await stats.excludeProcess(processId);

  // clear auto-persisting stats interval
  if (enableHealthChecks) {
    stats.clearAutoPersistInterval();
  }

  const noActiveRooms = new Deferred();
  if (stats.local.roomCount <= 0) {
    // no active rooms to dispose
    noActiveRooms.resolve();

  } else {
    // wait for all rooms to be disposed
    // TODO: set generous timeout in case
    events.once('no-active-rooms', () => noActiveRooms.resolve());
  }

  // - lock all local rooms to prevent new joins
  // - trigger `onBeforeShutdown()` on each room
  for (const roomId in rooms) {
    if (!rooms.hasOwnProperty(roomId)) {
      continue;
    }

    const room = rooms[roomId];
    room.lock();
    room.onBeforeShutdown();
  }

  await noActiveRooms;
}

export async function gracefullyShutdown(): Promise<any> {
  if (state === MatchMakerState.SHUTTING_DOWN) {
    return Promise.reject('already_shutting_down');
  }

  debugMatchMaking(`${processId} is shutting down!`);

  state = MatchMakerState.SHUTTING_DOWN;

  onReady = undefined;

  // - lock existing rooms
  // - stop accepting new rooms on this process
  // - wait for all rooms to be disposed
  await lockAndDisposeAll();

  if (isDevMode) {
    await cacheRoomHistory(rooms);
  }

  // make sure rooms are removed from cache
  await removeRoomsByProcessId(processId);

  // unsubscribe from process id channel
  presence.unsubscribe(getProcessChannel());

  // make sure all rooms are disposed
  return Promise.all(disconnectAll(
    (isDevMode)
      ? Protocol.WS_CLOSE_DEVMODE_RESTART
      : undefined
  ));
}

/**
 * Reserve a seat for a client in a room
 */
export async function reserveSeatFor(room: IRoomCache, options: ClientOptions, authData?: any) {
  const sessionId: string = authData?.sessionId || generateId();

  debugMatchMaking(
    'reserving seat. sessionId: \'%s\', roomId: \'%s\', processId: \'%s\'',
    sessionId, room.roomId, processId,
  );

  let successfulSeatReservation: boolean;

  try {
    successfulSeatReservation = await remoteRoomCall(
      room.roomId,
      '_reserveSeat',
      [sessionId, options, authData],
      REMOTE_ROOM_SHORT_TIMEOUT,
    );

  } catch (e) {
    debugMatchMaking(e);

    //
    // the room cache from an unavailable process might've been used here.
    // (this is a broken state when a process wasn't gracefully shut down)
    // perform a health-check on the process before proceeding.
    //
    if (
      e.message === "ipc_timeout" &&
      !(
        enableHealthChecks &&
        await healthCheckProcessId(room.processId)
      )
    ) {
      throw new SeatReservationError(`process ${room.processId} is not available.`);

    } else {
      successfulSeatReservation = false;
    }
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

async function callOnAuth(roomName: string, clientOptions?: ClientOptions, authContext?: AuthContext) {
  const roomClass = getRoomClass(roomName);
  if (roomClass && roomClass['onAuth'] && roomClass['onAuth'] !== Room['onAuth']) {
    const result = await roomClass['onAuth'](authContext.token, clientOptions, authContext)
    if (!result) {
      throw new ServerError(ErrorCode.AUTH_FAILED, 'onAuth failed');
    }
    return result;
  }
}

/**
 * Perform health check on all processes
 */
export async function healthCheckAllProcesses() {
  const allStats = await stats.fetchAll();

  const activeProcessChannels = (typeof(presence.channels) === "function") // TODO: remove this check on 0.17
    ? (await presence.channels("p:*")).map(c => c.substring(2))
    : [];

  if (allStats.length > 0) {
    await Promise.all(
      allStats
        .filter(stat => (
          stat.processId !== processId && // skip current process
          !activeProcessChannels.includes(stat.processId) // skip if channel is still listening
        ))
        .map(stat => healthCheckProcessId(stat.processId))
    );
  }
}

/**
 * Perform health check on a remote process
 * @param processId
 */
const _healthCheckByProcessId: { [processId: string]: Promise<any> } = {};
export function healthCheckProcessId(processId: string) {
  //
  // re-use the same promise if health-check is already in progress
  // (may occur when _reserveSeat() fails multiple times for the same 'processId')
  //
  if (_healthCheckByProcessId[processId] !== undefined) {
    return _healthCheckByProcessId[processId];
  }

  _healthCheckByProcessId[processId] = new Promise<boolean>(async (resolve, reject) => {
    logger.debug(`> Performing health-check against processId: '${processId}'...`);

    try {
      const requestTime = Date.now();

      await requestFromIPC<IRoomCache>(
        presence,
        getProcessChannel(processId),
        'healthcheck',
        [],
        REMOTE_ROOM_SHORT_TIMEOUT,
      );

      logger.debug(`✅ Process '${processId}' successfully responded (${Date.now() - requestTime}ms)`);

      // succeeded to respond
      resolve(true)

    } catch (e) {
      // process failed to respond - remove it from stats
      logger.debug(`❌ Process '${processId}' failed to respond. Cleaning it up.`);
      const isProcessExcluded = await stats.excludeProcess(processId);

      // clean-up possibly stale room ids
      if (isProcessExcluded && !isDevMode) {
        await removeRoomsByProcessId(processId);
      }

      resolve(false);
    } finally {
      delete _healthCheckByProcessId[processId];
    }
  });

  return _healthCheckByProcessId[processId];
}

/**
 * Remove cached rooms by processId
 * @param processId
 */
async function removeRoomsByProcessId(processId: string) {
  //
  // clean-up possibly stale room ids
  // (ungraceful shutdowns using Redis can result on stale room ids still on memory.)
  //
  await driver.cleanup(processId);
}

async function createRoomReferences(room: Room, init: boolean = false): Promise<boolean> {
  rooms[room.roomId] = room;

  if (init) {
    await subscribeIPC(
      presence,
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

/**
 * Used only during `joinOrCreate` to handle concurrent requests for creating a room.
 */
async function concurrentJoinOrCreateRoomLock(
  handler: RegisteredHandler,
  concurrencyKey: string,
  callback: (roomId?: string) => Promise<IRoomCache>
): Promise<IRoomCache> {
  return new Promise(async (resolve, reject) => {
    const hkey = getConcurrencyHashKey(handler.name);
    const concurrency = await presence.hincrbyex(
      hkey,
      concurrencyKey,
      1, // increment by 1
      MAX_CONCURRENT_CREATE_ROOM_WAIT_TIME * 2 // expire in 2x the time of MAX_CONCURRENT_CREATE_ROOM_WAIT_TIME
    ) - 1; // do not consider the current request

    const fulfill = async (roomId?: string) => {
      try {
        resolve(await callback(roomId));

      } catch (e) {
        reject(e);

      } finally {
        await presence.hincrbyex(hkey, concurrencyKey, -1, MAX_CONCURRENT_CREATE_ROOM_WAIT_TIME * 2);
      }
    };

    if (concurrency > 0) {
      debugMatchMaking(
        'receiving %d concurrent joinOrCreate for \'%s\' (%s)',
        concurrency, handler.name, concurrencyKey
      );

      try {
        const roomId = await subscribeWithTimeout(
          presence,
          `concurrent:${handler.name}:${concurrencyKey}`,
          (MAX_CONCURRENT_CREATE_ROOM_WAIT_TIME +
            (Math.min(concurrency, 3) * 0.2)) * 1000 // convert to milliseconds
        );

        return await fulfill(roomId);
      } catch (error) {
        // Ignore ipc_timeout error
      }
    }

    return await fulfill();
  });
}

function onClientJoinRoom(room: Room, client: Client) {
  // increment local CCU
  stats.local.ccu++;
  stats.persist();

  handlers[room.roomName].emit('join', room, client);
}

function onClientLeaveRoom(room: Room, client: Client, willDispose: boolean) {
  // decrement local CCU
  stats.local.ccu--;
  stats.persist();

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

function onVisibilityChange(room: Room, isInvisible: boolean): void {
  handlers[room.roomName].emit('visibility-change', room, isInvisible);
}

async function disposeRoom(roomName: string, room: Room) {
  debugMatchMaking('disposing \'%s\' (%s) on processId \'%s\' (graceful shutdown: %s)', roomName, room.roomId, processId, state === MatchMakerState.SHUTTING_DOWN);

  //
  // FIXME: this call should not be necessary.
  //
  // there's an unidentified edge case using LocalDriver where Room._dispose()
  // doesn't seem to be called [?], but "disposeRoom" is, leaving the matchmaker
  // in a broken state. (repeated ipc_timeout's for seat reservation on
  // non-existing rooms)
  //
  room.listing.remove();
  stats.local.roomCount--;

  // decrease amount of rooms this process is handling
  if (state !== MatchMakerState.SHUTTING_DOWN) {
    stats.persist();

    // remove from devMode restore list
    if (isDevMode) {
      await presence.hdel(getRoomRestoreListKey(), room.roomId);
    }
  }

  // emit disposal on registered session handler
  handlers[roomName].emit('dispose', room);

  // unsubscribe from remote connections
  presence.unsubscribe(getRoomChannel(room.roomId));

  // remove actual room reference
  delete rooms[room.roomId];
}

//
// Presence keys
//
function getRoomChannel(roomId: string) {
  return `$${roomId}`;
}

function getConcurrencyHashKey(roomName: string) {
  // concurrency hash
  return `ch:${roomName}`;
}

function getProcessChannel(id: string = processId) {
  return `p:${id}`;
}
