import { merge, retry } from './Utils';

import { Client, generateId } from './index';
import { IpcProtocol, Protocol } from './Protocol';

import { RegisteredHandler } from './matchmaker/RegisteredHandler';
import { Room, RoomConstructor, RoomInternalState } from './Room';

import { LocalPresence } from './presence/LocalPresence';
import { Presence } from './presence/Presence';

import { debugAndPrintError, debugMatchMaking } from './Debug';
import { MatchMakeError } from './errors/MatchMakeError';
import { SeatReservationError } from './errors/SeatReservationError';
import { MatchMakerDriver, RoomListingData } from './matchmaker/drivers/Driver';
import { LocalDriver } from './matchmaker/drivers/LocalDriver';

export type ClientOptions = any;

export interface RoomWithScore {
  roomId: string;
  score: number;
}

// remote room call timeouts
export const REMOTE_ROOM_SHORT_TIMEOUT = Number(process.env.COLYSEUS_PRESENCE_SHORT_TIMEOUT || 2000);

type RemoteRoomResponse<T= any> = [string?, T?];

const handlers: {[id: string]: RegisteredHandler} = {};
const localRooms: {[roomId: string]: Room} = {};

let presence: Presence;
let processId: string;
export let driver: MatchMakerDriver;

let isGracefullyShuttingDown: boolean = false;

export function setup(_presence?: Presence, _driver?: MatchMakerDriver, _processId?: string) {
  presence = _presence || new LocalPresence();
  driver = _driver || new LocalDriver();
  processId = _processId;
}

export async function joinOrCreate(roomName: string, options: ClientOptions) {
  return await retry(async () => {
    let room = await queryRoom(roomName, options);

    if (!room) {
      room = await createRoom(roomName, options);
    }

    return reserveSeatFor(room, options);
  }, 5, [SeatReservationError]);
}

export async function create(roomName: string, options: ClientOptions) {
  const handler = handlers[roomName];
  if (!handler) {
    throw new MatchMakeError(`no available handler for "${roomName}"`, Protocol.ERR_MATCHMAKE_NO_HANDLER);
  }

  // Object.keys(handler.options)
  const room = await createRoom(roomName, options);

  return reserveSeatFor(room, options);
}

export async function join(roomName: string, options: ClientOptions) {
  return await retry(async () => {
    const room = await queryRoom(roomName, options);

    if (!room) {
      throw new MatchMakeError(`no rooms found with provided criteria`, Protocol.ERR_MATCHMAKE_INVALID_CRITERIA);
    }

    return reserveSeatFor(room, options);
  });
}

export async function joinById(roomId: string, options: ClientOptions) {
  const room = await driver.findOne({ roomId });

  if (room) {
    const rejoinSessionId = options.sessionId;

    if (rejoinSessionId) {
      // handle re-connection!
      const [_, hasReservedSeat] = await remoteRoomCall(room.roomId, 'hasReservedSeat', [rejoinSessionId]);

      if (hasReservedSeat) {
        return { room, sessionId: rejoinSessionId };

      } else {
        throw new MatchMakeError(`session expired`, Protocol.ERR_MATCHMAKE_EXPIRED);

      }

    } else if (!room.locked) {
      return reserveSeatFor(room, options);

    } else {
      throw new MatchMakeError(`room "${roomId}" is locked`, Protocol.ERR_MATCHMAKE_INVALID_ROOM_ID);

    }

  } else {
    throw new MatchMakeError(`room "${roomId}" not found`, Protocol.ERR_MATCHMAKE_INVALID_ROOM_ID);
  }

}

export async function query(roomName?: string, conditions: any = {}) {
  if (roomName) { conditions.name = roomName; }

  // list only public rooms
  conditions.private = false;

  return await driver.find(conditions);
}

export async function queryRoom(roomName: string, options: ClientOptions): Promise<RoomListingData> {
  return await awaitRoomAvailable(roomName, async () => {
    const handler = handlers[roomName];
    if (!handler) {
      throw new MatchMakeError(`no available handler for "${roomName}"`, Protocol.ERR_MATCHMAKE_NO_HANDLER);
    }

    const roomQuery = driver.findOne({
      locked: false,
      name: roomName,
      ...handler.getFilterOptions(options),
    });

    if (handler.sortOptions) {
      roomQuery.sort(handler.sortOptions);
    }

    return await roomQuery;
  });
}

export async function remoteRoomCall<R= any>(
  roomId: string,
  method: string,
  args?: any[],
  rejectionTimeout = REMOTE_ROOM_SHORT_TIMEOUT,
): Promise<RemoteRoomResponse<R>> {
  const room = localRooms[roomId];

  if (!room) {
    return new Promise((resolve, reject) => {
      let unsubscribeTimeout: NodeJS.Timer;

      const requestId = generateId();
      const channel = `${roomId}:${requestId}`;

      const unsubscribe = () => {
        presence.unsubscribe(channel);
        clearTimeout(unsubscribeTimeout);
      };

      presence.subscribe(channel, (message) => {
        const [code, data] = message;
        if (code === IpcProtocol.SUCCESS) {
          resolve(data);

        } else if (code === IpcProtocol.ERROR) {
          reject(data);
        }
        unsubscribe();
      });

      presence.publish(getRoomChannel(roomId), [method, requestId, args]);

      unsubscribeTimeout = setTimeout(() => {
        unsubscribe();

        const request = `${method}${ args && ' with args ' + JSON.stringify(args) || '' }`;
        reject(new Error(`remote room (${roomId}) timed out, requesting "${request}". ` +
          `Timeout setting: ${rejectionTimeout}ms`));
      }, rejectionTimeout);
    });

  } else {
    return [
      processId,
      (!args && typeof (room[method]) !== 'function')
        ? room[method]
        : (await room[method].apply(room, args)),
    ];
  }
}

export function defineRoomType(name: string, klass: RoomConstructor, defaultOptions: any = {}) {
  const registeredHandler = new RegisteredHandler(klass, defaultOptions);

  handlers[name] = registeredHandler;

  cleanupStaleRooms(name);

  return registeredHandler;
}

export function hasHandler(name: string) {
  return handlers[ name ] !== undefined;
}

export async function createRoom(roomName: string, clientOptions: ClientOptions): Promise<RoomListingData> {
  const registeredHandler = handlers[ roomName ];
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

    } catch (e) {
      debugAndPrintError(e);
      throw new MatchMakeError(e.message, Protocol.ERR_MATCHMAKE_UNHANDLED);
    }
  }

  room._internalState = RoomInternalState.CREATED;

  room.listing.roomId = room.roomId;
  room.listing.maxClients = room.maxClients;

  // imediatelly ask client to join the room
  debugMatchMaking('spawning \'%s\', roomId: %s, processId: %s', roomName, room.roomId, processId);

  room.on('lock', lockRoom.bind(this, roomName, room));
  room.on('unlock', unlockRoom.bind(this, roomName, room));
  room.on('join', onClientJoinRoom.bind(this, room));
  room.on('leave', onClientLeaveRoom.bind(this, room));
  room.once('dispose', disposeRoom.bind(this, roomName, room));
  room.once('disconnect', () => room.removeAllListeners());

  // room always start unlocked
  await createRoomReferences(room, true);
  await room.listing.save();

  registeredHandler.emit('create', room);

  return room.listing;
}

export function getRoomById(roomId: string) {
  return localRooms[roomId];
}

export function gracefullyShutdown(): Promise<any> {
  if (isGracefullyShuttingDown) {
    return Promise.reject(false);
  }

  isGracefullyShuttingDown = true;

  const promises = [];

  for (const roomId in localRooms) {
    if (!localRooms.hasOwnProperty(roomId)) {
      continue;
    }

    const room = localRooms[roomId];
    promises.push( room.disconnect() );
  }

  return Promise.all(promises);
}

export async function reserveSeatFor(room: RoomListingData, options) {
  const sessionId: string = generateId();

  debugMatchMaking(
    'reserving seat. sessionId: \'%s\', roomId: \'%s\', processId: \'%s\'',
    sessionId, room.roomId, processId,
  );

  const [_, reserveSeatSuccessful] = await remoteRoomCall(room.roomId, '_reserveSeat', [sessionId, options]);
  if (!reserveSeatSuccessful) {
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

      clearRoomReferences({ roomId: room.roomId, roomName } as Room);
    }
  }));
}

async function createRoomReferences(room: Room, init: boolean = false): Promise<boolean> {
  localRooms[room.roomId] = room;

  // add unlocked room reference
  await presence.sadd(room.roomName, room.roomId);

  if (init) {
    await presence.subscribe(getRoomChannel(room.roomId), (message) => {
      const [method, requestId, args] = message;

      const reply = (code, data) => {
        presence.publish(`${room.roomId}:${requestId}`, [code, [processId, data]]);
      };

      // reply with property value
      if (!args && typeof (room[method]) !== 'function') {
        return reply(IpcProtocol.SUCCESS, room[method]);
      }

      // reply with method result
      let response: any;
      try {
        response = room[method].apply(room, args);

      } catch (e) {
        debugAndPrintError(e.stack || e);
        return reply(IpcProtocol.ERROR, e.message || e);
      }

      if (!(response instanceof Promise)) {
        return reply(IpcProtocol.SUCCESS, response);
      }

      response.
        then((result) => reply(IpcProtocol.SUCCESS, result)).
        catch((e) => {
          // user might have called `reject()` without arguments.
          const err = e && e.message || e;
          reply(IpcProtocol.ERROR, err);
        });
    });
  }

  return true;
}

function clearRoomReferences(room: Room) {
  presence.srem(room.roomName, room.roomId);

  // clear list of connecting clients.
  presence.del(room.roomId);
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

function getRoomChannel(roomId: string) {
  return `$${roomId}`;
}

function getHandlerConcurrencyKey(name: string) {
  return `${name}:c`;
}

function onClientJoinRoom(room: Room, client: Client) {
  handlers[room.roomName].emit('join', room, client);
}

function onClientLeaveRoom(room: Room, client: Client) {
  handlers[room.roomName].emit('leave', room, client);
}

function lockRoom(roomName: string, room: Room): void {
  clearRoomReferences(room);

  // emit public event on registered handler
  handlers[room.roomName].emit('lock', room);
}

async function unlockRoom(roomName: string, room: Room) {
  if (await createRoomReferences(room)) {

    // emit public event on registered handler
    handlers[room.roomName].emit('unlock', room);
  }
}

function disposeRoom(roomName: string, room: Room): void {
  debugMatchMaking('disposing \'%s\' (%s) on processId \'%s\'', roomName, room.roomId, processId);

  // remove from room listing
  room.listing.remove();

  // emit disposal on registered session handler
  handlers[roomName].emit('dispose', room);

  // remove concurrency key
  presence.del(getHandlerConcurrencyKey(roomName));

  // remove from available rooms
  clearRoomReferences(room);

  // unsubscribe from remote connections
  presence.unsubscribe(getRoomChannel(room.roomId));

  // remove actual room reference
  delete localRooms[room.roomId];
}
