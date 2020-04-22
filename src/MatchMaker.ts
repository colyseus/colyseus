import { ErrorCode } from './Protocol';

import { requestFromIPC, subscribeIPC } from './IPC';
import { generateId, merge, REMOTE_ROOM_SHORT_TIMEOUT, retry } from './Utils';

import { RegisteredHandler } from './matchmaker/RegisteredHandler';
import { Room, RoomInternalState } from './Room';

import { LocalPresence } from './presence/LocalPresence';
import { Presence } from './presence/Presence';

import { debugAndPrintError, debugMatchMaking } from './Debug';
import { SeatReservationError } from './errors/SeatReservationError';
import { ServerError } from './errors/ServerError';
import { MatchMakerDriver, RoomListingData } from './matchmaker/drivers/Driver';
import { LocalDriver } from './matchmaker/drivers/LocalDriver';
import { Client } from './transport/Transport';
import { Type } from './types';

export { MatchMakerDriver };

export type ClientOptions = any;

export interface SeatReservation {
  sessionId: string;
  room: RoomListingData;
}

const handlers: {[id: string]: RegisteredHandler} = {};
const rooms: {[roomId: string]: Room} = {};

export let processId: string;
export let presence: Presence;
export let driver: MatchMakerDriver;

let isGracefullyShuttingDown: boolean;

export function setup(_presence?: Presence, _driver?: MatchMakerDriver, _processId?: string) {
  presence = _presence || new LocalPresence();
  driver = _driver || new LocalDriver();
  processId = _processId;
  isGracefullyShuttingDown = false;

  /**
   * Subscribe to remote `handleCreateRoom` calls.
   */
  subscribeIPC(presence, processId, getProcessChannel(), (_, args) => {
    return handleCreateRoom.apply(undefined, args);
  });

  presence.hset(getRoomCountKey(), processId, '0');
}

/**
 * Join or create into a room and return seat reservation
 */
export async function joinOrCreate(roomName: string, options: ClientOptions = {}) {
  return await retry<Promise<SeatReservation>>(async () => {
    let room = await findOneRoomAvailable(roomName, options);

    if (!room) {
      room = await createRoom(roomName, options);
    }

    return await reserveSeatFor(room, options);
  }, 5, [SeatReservationError]);
}

/**
 * Create a room and return seat reservation
 */
export async function create(roomName: string, options: ClientOptions = {}) {
  const room = await createRoom(roomName, options);
  return reserveSeatFor(room, options);
}

/**
 * Join a room and return seat reservation
 */
export async function join(roomName: string, options: ClientOptions = {}) {
  return await retry<Promise<SeatReservation>>(async () => {
    const room = await findOneRoomAvailable(roomName, options);

    if (!room) {
      throw new ServerError(ErrorCode.MATCHMAKE_INVALID_CRITERIA, `no rooms found with provided criteria`);
    }

    return reserveSeatFor(room, options);
  });
}

/**
 * Join a room by id and return seat reservation
 */
export async function joinById(roomId: string, options: ClientOptions = {}) {
  const room = await driver.findOne({ roomId });

  if (room) {
    const rejoinSessionId = options.sessionId;

    if (rejoinSessionId) {
      // handle re-connection!
      const hasReservedSeat = await remoteRoomCall(room.roomId, 'hasReservedSeat', [rejoinSessionId]);

      if (hasReservedSeat) {
        return { room, sessionId: rejoinSessionId };

      } else {
        throw new ServerError(ErrorCode.MATCHMAKE_EXPIRED, `session expired: ${rejoinSessionId}`);

      }

    } else if (!room.locked) {
      return reserveSeatFor(room, options);

    } else {
      throw new ServerError( ErrorCode.MATCHMAKE_INVALID_ROOM_ID, `room "${roomId}" is locked`);

    }

  } else {
    throw new ServerError( ErrorCode.MATCHMAKE_INVALID_ROOM_ID, `room "${roomId}" not found`);
  }

}

/**
 * Perform a query for all cached rooms
 */
export async function query(conditions: any = {}) {
  return await driver.find(conditions);
}

/**
 * Find for a public and unlocked room available
 */
export async function findOneRoomAvailable(roomName: string, options: ClientOptions): Promise<RoomListingData> {
  return await awaitRoomAvailable(roomName, async () => {
    const handler = handlers[roomName];
    if (!handler) {
      throw new ServerError( ErrorCode.MATCHMAKE_NO_HANDLER, `provided room name "${roomName}" not defined`);
    }

    const roomQuery = driver.findOne({
      locked: false,
      name: roomName,
      private: false,
      ...handler.getFilterOptions(options),
    });

    if (handler.sortOptions) {
      roomQuery.sort(handler.sortOptions);
    }

    return await roomQuery;
  });
}

/**
 * Call a method or return a property on a remote room.
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
      return await requestFromIPC<R>(presence, getRoomChannel(roomId), method, args);

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
        : (await room[method].apply(room, args));
  }
}

export function defineRoomType<T extends Type<Room>>(
  name: string,
  klass: T,
  defaultOptions?: Parameters<NonNullable<InstanceType<T>['onCreate']>>[0],
) {
  const registeredHandler = new RegisteredHandler(klass, defaultOptions);

  handlers[name] = registeredHandler;

  cleanupStaleRooms(name);

  return registeredHandler;
}

export function removeRoomType(name: string) {
  delete handlers[name];
  cleanupStaleRooms(name);
}

export function hasHandler(name: string) {
  return handlers[ name ] !== undefined;
}

/**
 * Create a room
 */
export async function createRoom(roomName: string, clientOptions: ClientOptions): Promise<RoomListingData> {
  const roomsSpawnedByProcessId = await presence.hgetall(getRoomCountKey());

  const processIdWithFewerRooms = (
    Object.keys(roomsSpawnedByProcessId).sort((p1, p2) => {
      return (Number(roomsSpawnedByProcessId[p1]) > Number(roomsSpawnedByProcessId[p2]))
        ? 1
        : -1;
    })[0]
  ) || processId;

  if (processIdWithFewerRooms === processId) {
    // create the room on this process!
    return await handleCreateRoom(roomName, clientOptions);

  } else {
    // ask other process to create the room!
    let room: RoomListingData;

    try {
      room = await requestFromIPC<RoomListingData>(
        presence,
        getProcessChannel(processIdWithFewerRooms),
        undefined,
        [roomName, clientOptions],
        REMOTE_ROOM_SHORT_TIMEOUT,
      );

    } catch (e) {
      // if other process failed to respond, create the room on this process
      debugAndPrintError(e);
      room = await handleCreateRoom(roomName, clientOptions);
    }

    return room;
  }
}

async function handleCreateRoom(roomName: string, clientOptions: ClientOptions): Promise<RoomListingData> {
  const registeredHandler = handlers[roomName];

  if (!registeredHandler) {
    throw new ServerError( ErrorCode.MATCHMAKE_NO_HANDLER, `provided room name "${roomName}" not defined`);
  }

  const room = new registeredHandler.klass();

  // set room public attributes
  room.roomId = generateId();
  room.roomName = roomName;
  room.presence = presence;

  // create a RoomCache reference.
  room.listing = driver.createInstance({
    name: roomName,
    processId,
    ...registeredHandler.getFilterOptions(clientOptions),
  });

  if (room.onCreate) {
    try {
      await room.onCreate(merge({}, clientOptions, registeredHandler.options));

      // increment amount of rooms this process is handling
      presence.hincrby(getRoomCountKey(), processId, 1);

    } catch (e) {
      debugAndPrintError(e);
      throw new ServerError(
        e.code || ErrorCode.MATCHMAKE_UNHANDLED,
        e.message,
      );
    }
  }

  room.internalState = RoomInternalState.CREATED;

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

export function gracefullyShutdown(): Promise<any> {
  if (isGracefullyShuttingDown) {
    return Promise.reject('already_shutting_down');
  }

  isGracefullyShuttingDown = true;

  debugMatchMaking(`${processId} is shutting down!`);

  // remove processId from room count key
  presence.hdel(getRoomCountKey(), processId);

  // unsubscribe from process id channel
  presence.unsubscribe(getProcessChannel());

  const promises: Array<Promise<any>> = [];

  for (const roomId in rooms) {
    if (!rooms.hasOwnProperty(roomId)) {
      continue;
    }
    promises.push(rooms[roomId].disconnect());
  }

  return Promise.all(promises);
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

  return { room, sessionId };
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

    // avoid having too long timeout if 10+ clients ask to join at the same time
    const concurrencyTimeout = Math.min(concurrency * 100, REMOTE_ROOM_SHORT_TIMEOUT);

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
  handlers[room.roomName].emit('join', room, client);
}

function onClientLeaveRoom(room: Room, client: Client, willDispose: boolean) {
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

  // decrease amount of rooms this process is handling
  if (!isGracefullyShuttingDown) {
    presence.hincrby(getRoomCountKey(), processId, -1);
  }

  // remove from room listing (already removed if `disconnect()` has been called)
  if (room.internalState !== RoomInternalState.DISCONNECTING) {
    await room.listing.remove();
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
// Presence keys
//

function getRoomChannel(roomId: string) {
  return `$${roomId}`;
}

function getHandlerConcurrencyKey(name: string) {
  return `c:${name}`;
}

function getProcessChannel(id: string = processId) {
  return `p:${id}`;
}

function getRoomCountKey() {
  return 'roomcount';
}
