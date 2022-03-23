import nanoid from 'nanoid';

import {debugAndPrintError, debugMatchMaking} from './Debug';
import {
  createRoom, createRoomReferences,
  disposeRoom,
  driver, handlers,
  lockRoom, onClientJoinRoom, onClientLeaveRoom,
  presence,
  processId,
  publicAddress,
  remoteRoomCall, unlockRoom
} from "./MatchMaker";
import {Room, RoomInternalState} from "./Room";
import { EventEmitter } from "events";
import { ServerOpts, Socket } from "net";
import { logger } from './Logger';
import {subscribeIPC} from "./IPC";
import {ServerError} from "./errors/ServerError";
import {ErrorCode} from "./Protocol";
import {RegisteredHandler} from "./matchmaker/RegisteredHandler";

// remote room call timeouts
export const REMOTE_ROOM_SHORT_TIMEOUT = Number(process.env.COLYSEUS_PRESENCE_SHORT_TIMEOUT || 2000);

export function generateId(length: number = 9) {
  return nanoid(length);
}

//
// nodemon sends SIGUSR2 before reloading
// (https://github.com/remy/nodemon#controlling-shutdown-of-your-script)
//
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGUSR2'];

export function registerGracefulShutdown(callback: (err?: Error) => void) {
  /**
   * Gracefully shutdown on uncaught errors
   */
  process.on('uncaughtException', (err) => {
    debugAndPrintError(err);
    callback(err);
  });

  signals.forEach((signal) =>
    process.once(signal, () => callback()));
}

export function retry<T = any>(
  cb: Function,
  maxRetries: number = 3,
  errorWhiteList: any[] = [],
  retries: number = 0,
) {
  return new Promise<T>((resolve, reject) => {
    cb()
      .then(resolve)
      .catch((e) => {
        if (
          errorWhiteList.indexOf(e.constructor) !== -1 &&
          retries++ < maxRetries
        ) {
          setTimeout(() => {
            retry<T>(cb, maxRetries, errorWhiteList, retries).
              then(resolve).
              catch((e2) => reject(e2));
          }, Math.floor(Math.random() * Math.pow(2, retries) * 400));

        } else {
          reject(e);
        }
      });
  });
}

export function spliceOne(arr: any[], index: number): boolean {
  // manually splice availableRooms array
  // http://jsperf.com/manual-splice
  if (index === -1 || index >= arr.length) {
    return false;
  }

  const len = arr.length - 1;
  for (let i = index; i < len; i++) {
    arr[i] = arr[i + 1];
  }

  arr.length = len;
  return true;
}

export class Deferred<T= any> {
  public promise: Promise<T>;

  public resolve: Function;
  public reject: Function;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  public then(func: (value: T) => any) {
    return this.promise.then.apply(this.promise, arguments);
  }

  public catch(func: (value: any) => any) {
    return this.promise.catch(func);
  }

}

export function merge(a: any, ...objs: any[]): any {
  for (let i = 0, len = objs.length; i < len; i++) {
    const b = objs[i];
    for (const key in b) {
      if (b.hasOwnProperty(key)) {
        a[key] = b[key];
      }
    }
  }
  return a;
}

export class HybridArray<T> {
  public uniqueProperty: string;
  public hashedArray: { [key: string]: T } = {};
  public array: T[] = [];

  constructor(uniquePropertyName: string, items?: T[]) {
    this.uniqueProperty = uniquePropertyName;
    if (items) {
      this.array = this.array.concat(items);
      for (const element of items) {
        this.hashedArray[element[this.uniqueProperty]] = element;
      }
    }
  }

  public get length(): number {
    return this.array.length;
  }

  public add(item: T) {
    if (!this.hashedArray[item[this.uniqueProperty]]) {
      this.array.push(item);
      this.hashedArray[item[this.uniqueProperty]] = item;

    } else {
      logger.warn(`.add(): element already exists:`, item[this.uniqueProperty]);
    }
  }

  public at(index: number): T | undefined {
    if (index >= this.array.length) {
      this._badIndexWarning(index);

    } else {
      return this.array[index];
    }
  }

  public concat(items: T[]) {
    if (items) {
      for (const item of items) {
        this.hashedArray[item[this.uniqueProperty]] = item;
      }
      this.array.concat(items);
    }
    return this;
  }

  public find<S extends T>(predicate: (this: void, value: T, index: number, obj: T[]) => value is S, thisArg?: any): S;
  public find(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): T;
  public find(predicate: any, thisArg?: any): T | undefined {
    return this.array.find(predicate, thisArg);
  }

  public filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): T[]
  public filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S[] {
    return this.array.filter(predicate, thisArg);
  }

  public forEach(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void {
    Array.prototype.forEach.call(this.array, callbackfn);
  }

  public get(key: string): T | undefined {
    return this.hashedArray[key];
  }

  public includes(element: T) {
    return this.hashedArray[element[this.uniqueProperty]] !== undefined;
  }

  public indexOf(element: T): number {
    return this.array.indexOf(element);
  }

  public map(callback) {
    const result: T[] = [];
    for (let index = 0; index < this.array.length; index++) {
      result.push(callback(this.array[index], index, this.array));
    }
    return result;
  }

  public deleteAt(index: number) {
    if (index >= this.array.length) {
      this._badIndexWarning(index);
      return undefined;

    } else {
      const removable = this.spliceOne(index);
      delete this.hashedArray[removable[this.uniqueProperty]];
      return removable;
    }
  }

  public deleteByKey(key: string): T {
    if (!this.hashedArray[key]) {
      logger.error(`deleteByKey(): no such element for '${key}'.`);
      return undefined;
    } else {
      const removable = this.spliceOne(this.indexOf(this.hashedArray[key]));
      delete this.hashedArray[key];
      return removable;
    }
  }

  public delete(obj: T): T {
    if (this.hashedArray[obj[this.uniqueProperty]]) {
      return this.deleteByKey(obj[this.uniqueProperty]);

    } else if (this.indexOf(obj) != -1) {
      return this.deleteAt(this.indexOf(obj));

    } else {
      return undefined;
    }
  }

  private _badIndexWarning(index) {
    logger.warn(`Index out of range, index: ${index}`);
  }

  private spliceOne(index: number): T {
    // manually splice availableRooms array
    // http://jsperf.com/manual-splice
    if (index === -1 || index >= this.array.length) {
      this._badIndexWarning(index);
      return undefined;
    }

    const itemRemoved = this.array[index];

    const len = this.array.length - 1;
    for (let i = index; i < len; i++) {
      this.array[i] = this.array[i + 1];
    }
    this.array.length = len;

    return itemRemoved;
  }
}

export declare interface DummyServer {
  constructor(options?: ServerOpts, connectionListener?: (socket: Socket) => void);

  listen(port?: number, hostname?: string, backlog?: number, listeningListener?: () => void): this;
  close(callback?: (err?: Error) => void): this;
}

export class DummyServer extends EventEmitter {};

export async function reloadFromCache(rooms: {[roomId: string]: Room}) {
  const roomHistoryList = await presence.hgetall(getRoomHistoryListKey());
  if(roomHistoryList) {
    for(const [key, value] of Object.entries(roomHistoryList)) {
      const roomHistory = JSON.parse(value);

      // Create the room from cached history
      const registeredHandler = handlers[roomHistory.roomName];

      if (!registeredHandler) {
        throw new ServerError( ErrorCode.MATCHMAKE_NO_HANDLER, `provided room name "${roomHistory.roomName}" not defined`);
      }

      const recreatedRoom = new registeredHandler.klass();

      // set room public attributes
      recreatedRoom.roomId = key;
      recreatedRoom.roomName = roomHistory.roomName;
      recreatedRoom.presence = presence;

      const additionalListingData: any = registeredHandler.getFilterOptions(roomHistory.clientOptions);

      // assign public host
      if (publicAddress) {
        additionalListingData.publicAddress = publicAddress;
      }

      // create a RoomCache reference.
      recreatedRoom.listing = driver.createInstance({
        name: roomHistory.roomName,
        processId,
        ...additionalListingData
      });

      if (recreatedRoom.onCreate) {
        try {
          await recreatedRoom.onCreate(merge({}, roomHistory.clientOptions, registeredHandler.options));

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

      recreatedRoom.internalState = RoomInternalState.CREATED;

      recreatedRoom.listing.roomId = recreatedRoom.roomId;
      recreatedRoom.listing.maxClients = recreatedRoom.maxClients;

      // imediatelly ask client to join the room
      debugMatchMaking('spawning \'%s\', roomId: %s, processId: %s', roomHistory.roomName, recreatedRoom.roomId, processId);

      recreatedRoom._events.on('lock', lockRoom.bind(this, recreatedRoom));
      recreatedRoom._events.on('unlock', unlockRoom.bind(this, recreatedRoom));
      recreatedRoom._events.on('join', onClientJoinRoom.bind(this, recreatedRoom));
      recreatedRoom._events.on('leave', onClientLeaveRoom.bind(this, recreatedRoom));
      recreatedRoom._events.once('dispose', disposeRoom.bind(this, roomHistory.roomName, recreatedRoom));
      recreatedRoom._events.once('disconnect', () => recreatedRoom._events.removeAllListeners());

      // room always start unlocked
      await createRoomReferences(recreatedRoom, true);
      await recreatedRoom.listing.save();

      registeredHandler.emit('create', roomHistory);

      // Restore cached room state
      recreatedRoom.state = roomHistory.state;

      // Reserve seats for clients from cached history
      for(const session of roomHistory.clients) {
        await remoteRoomCall(key, '_reserveSeat', [session.sessionId, {}]);
      }
    }
  }
}

export async function cacheRoomHistory(rooms: {[roomId: string]: Room}) {
  for(const room of Object.values(rooms)) {
    const roomHistoryResult = await presence.hget(getRoomHistoryListKey(), room.roomId);
    if(roomHistoryResult) {
      const roomHistory = JSON.parse(roomHistoryResult);
      roomHistory["state"] = room.state;
      roomHistory["clients"] = room.clients.array;
      // Rewrite updated room history
      await presence.hdel(getRoomHistoryListKey(), room.roomId);
      await presence.hset(getRoomHistoryListKey(), room.roomId, JSON.stringify(roomHistory));
    }
  }
}

export function getRoomCountKey() {
  return 'roomcount';
}

export function getRoomCacheKey() {
  return 'roomcaches';
}

export function getRoomHistoryListKey() {
  return 'roomhistory';
}
