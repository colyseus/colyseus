import debug from 'debug';
import { logger } from '../Logger.js';
import { debugAndPrintError } from '../Debug.js';

import { getLocalRoomById, handleCreateRoom, presence, remoteRoomCall } from '../MatchMaker.js';
import type { Room } from '../Room.js';

export const debugDevMode = debug('colyseus:devmode');

export let isDevMode: boolean = false;

export function setDevMode(bool: boolean) {
  isDevMode = bool;
}

export async function reloadFromCache() {
  const roomHistoryList = Object.entries(await presence.hgetall(getRoomRestoreListKey()));
  debugDevMode("rooms to restore: %i", roomHistoryList.length);

  for (const [roomId, value] of roomHistoryList) {
    const roomHistory = JSON.parse(value);
    debugDevMode("restoring room %s (%s)", roomHistory.roomName, roomId);

    const recreatedRoomListing = await handleCreateRoom(roomHistory.roomName, roomHistory.clientOptions, roomId);
    const recreatedRoom = getLocalRoomById(recreatedRoomListing.roomId);
    logger.debug(`🔄 room '${roomId}' has been restored.`);

    // Set previous state
    if (roomHistory.hasOwnProperty("state")) {
      recreatedRoom.state.decode(roomHistory.state);

      //
      // WORKAROUND: @colyseus/schema is not capable of encoding a decoded
      // state. thus, we need a fresh clone immediately after decoding
      //
      recreatedRoom.setState(recreatedRoom.state.clone());
      logger.debug(`📋 room '${roomId}' state =>`, recreatedRoom.state.toJSON());
    }

    // call `onRestoreRoom` with custom 'cache'd property.
    recreatedRoom.onRestoreRoom?.(roomHistory["cache"]);

    // Reserve seats for clients from cached history
    if (roomHistory.clients) {
      for (const previousSessionId of roomHistory.clients) {
        // reserve seat for 20 seconds
        await remoteRoomCall(recreatedRoomListing.roomId, '_reserveSeat', [previousSessionId, {}, 20, false, true]);
      }
    }
  }

  if (roomHistoryList.length > 0) {
    logger.debug("✅", roomHistoryList.length, "room(s) have been restored.");
  }
}

export async function cacheRoomHistory(rooms: { [roomId: string]: Room }) {
  for (const room of Object.values(rooms)) {
    const roomHistoryResult = await presence.hget(getRoomRestoreListKey(), room.roomId);
    if (roomHistoryResult) {
      try {
        const roomHistory = JSON.parse(roomHistoryResult);

        // custom cache method
        roomHistory["cache"] = room.onCacheRoom?.();

        // encode state
        debugDevMode("caching room %s (%s)", room.roomName, room.roomId);

        if (room.state) {
          roomHistory["state"] = room.state.encodeAll();
        }

        // cache active clients and reserved seats
        roomHistory["clients"] = room.clients.map((client) => client.sessionId);

        for (const sessionId in room['reservedSeats']) {
          roomHistory["clients"].push(sessionId);
        }

        await presence.hset(getRoomRestoreListKey(), room.roomId, JSON.stringify(roomHistory));

        // Rewrite updated room history
        logger.debug(`💾 caching room '${room.roomId}' (clients: ${room.clients.length}, state size: ${(roomHistory["state"] || []).length} bytes)`);

      } catch (e) {
        debugAndPrintError(`❌ couldn't cache room '${room.roomId}', due to:\n${e.stack}`);
      }
    }
  }
}

export async function getPreviousProcessId(hostname) {
  return await presence.hget(getProcessRestoreKey(), hostname);
}

export function getRoomRestoreListKey() {
  return 'roomhistory';
}

export function getProcessRestoreKey() {
  return 'processhistory';
}
