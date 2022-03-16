import nanoid from 'nanoid';

import { debugAndPrintError } from './Debug';
import { createRoom, presence } from "./MatchMaker";
import { Room } from "./Room";

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

export async function reloadFromCache(rooms: {[roomId: string]: Room}) {
  const roomHistoryList = await presence.hgetall(getRoomHistoryListKey());
  if(roomHistoryList) {
    for(const [key, value] of Object.entries(roomHistoryList)) {
      const roomHistory = JSON.parse(value);
      const tempRoomListingData = await createRoom(roomHistory.roomName, roomHistory.clientOptions);
      const tempRoom = rooms[tempRoomListingData.roomId];
      const tempRoomCache = JSON.parse(await presence.hget(getRoomCacheKey(), key));

      // Delete temporary room references from cache
      delete rooms[tempRoomListingData.roomId];
      await presence.hdel(getRoomCacheKey(), key);
      await presence.hdel(getRoomCacheKey(), tempRoomListingData.roomId);
      await presence.hdel(getRoomHistoryListKey(), tempRoomListingData.roomId);

      // Restore previous roomId and state
      tempRoom.roomId = key;
      tempRoom.state = roomHistory.state;
      tempRoomCache.processId = tempRoomListingData.processId;
      tempRoomCache.roomId = key;
      await presence.hset(getRoomCacheKey(), key, JSON.stringify(tempRoomCache));
      rooms[key] = tempRoom;
    }
  }
}

export async function cacheRoomHistory(rooms: {[roomId: string]: Room}) {
  for(const room of Object.values(rooms)) {
    const roomHistoryResult = await presence.hget(getRoomHistoryListKey(), room.roomId);
    if(roomHistoryResult) {
      const roomHistory = JSON.parse(roomHistoryResult);
      roomHistory["state"] = room.state;
      roomHistory["clients"] = room.clients;
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
