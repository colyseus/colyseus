import fs from 'fs';
import path from 'path';
import { type Schema, MapSchema, ArraySchema, SetSchema, CollectionSchema, $childType, $changes } from '@colyseus/schema';
import { logger } from '../Logger.ts';
import { debugAndPrintError, debugDevMode } from '../Debug.ts';
import { getLocalRoomById, handleCreateRoom, presence, remoteRoomCall } from '../MatchMaker.ts';
import type { Room } from '../Room.ts';

const DEVMODE_CACHE_FILE_PATH = path.resolve(".devmode.json");

export let isDevMode: boolean = false;

export function hasDevModeCache() {
  return fs.existsSync(DEVMODE_CACHE_FILE_PATH);
}

export function getDevModeCache() {
  return JSON.parse(fs.readFileSync(DEVMODE_CACHE_FILE_PATH, 'utf8')) || {};
}

export function writeDevModeCache(cache: any) {
  fs.writeFileSync(DEVMODE_CACHE_FILE_PATH, JSON.stringify(cache, null, 2), 'utf8');
}

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

    // Restore previous state
    if (roomHistory.hasOwnProperty("state")) {
      try {
        const rawState = JSON.parse(roomHistory.state);
        logger.debug(`📋 room '${roomId}' state =>`, rawState);

        (recreatedRoom.state as Schema).restore(rawState);

        // Restore the encoder's nextUniqueId so refIds increase
        // monotonically across HMR cycles. Without this, restore()
        // always produces the same refIds (0,1,2,3...) and onJoin()
        // always assigns the same next refIds (4,5...), causing the
        // client decoder to reuse stale instances on the 2nd+ cycle.
        if (roomHistory.nextRefId !== undefined) {
          const encoderRoot = recreatedRoom.state[$changes]?.root;
          if (encoderRoot && roomHistory.nextRefId > encoderRoot['nextUniqueId']) {
            encoderRoot['nextUniqueId'] = roomHistory.nextRefId;
          }
        }
      } catch (e: any) {
        debugAndPrintError(`❌ couldn't restore room '${roomId}' state:\n${e.stack}`);
      }
    }

    // Reserve seats for clients from cached history.
    // Skip entries without a reconnectionToken — these are stale
    // seats from allowReconnection() where the client already left
    // (e.g. page refresh). Restoring them would block room disposal.
    if (roomHistory.clients) {
      for (const clientData of roomHistory.clients) {
        const { sessionId, reconnectionToken } = clientData;
        if (!reconnectionToken) { continue; }
        // TODO: need to restore each client's StateView as well
        await remoteRoomCall(recreatedRoomListing.roomId, '_reserveSeat', [sessionId, {}, {}, recreatedRoom.seatReservationTimeout, false, reconnectionToken]);
      }
    }

    // call `onRestoreRoom` with custom 'cache'd property.
    recreatedRoom.onRestoreRoom?.(roomHistory["cache"]);

    logger.debug(`🔄 room '${roomId}' has been restored with ${roomHistory.clients?.length || 0} reserved seats: ${roomHistory.clients?.map((c: any) => c.sessionId).join(", ")}`);
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
          roomHistory["state"] = JSON.stringify(room.state);

          // Cache the encoder's nextUniqueId so it can be restored.
          // This ensures refIds increase monotonically across HMR cycles,
          // preventing the client decoder from reusing stale refs that
          // happen to have the same refId as newly created instances.
          const encoderRoot = room.state[$changes]?.root;
          if (encoderRoot) {
            roomHistory["nextRefId"] = encoderRoot['nextUniqueId'];
          }
        }

        // cache active clients with their reconnection tokens
        // TODO: need to cache each client's StateView as well
        const activeClients = room.clients.map((client) => ({
          sessionId: client.sessionId,
          reconnectionToken: client.reconnectionToken,
        }));

        // collect active client sessionIds to avoid duplicates
        const activeSessionIds = new Set(activeClients.map((c) => c.sessionId));

        // also cache reserved seats (they don't have reconnectionTokens yet)
        // filter out reserved seats that are already active clients (from devMode reconnection)
        const reservedSeats = Object.keys(room['_reservedSeats'])
          .filter((sessionId) => !activeSessionIds.has(sessionId))
          .map((sessionId) => ({
            sessionId,
            reconnectionToken: undefined,
          }));

        roomHistory["clients"] = activeClients.concat(reservedSeats);

        await presence.hset(getRoomRestoreListKey(), room.roomId, JSON.stringify(roomHistory));

        // Rewrite updated room history
        logger.debug(`💾 caching room '${room.roomId}' (clients: ${room.clients.length}, has state: ${roomHistory["state"] !== undefined ? "yes" : "no"})`);

      } catch (e: any) {
        debugAndPrintError(`❌ couldn't cache room '${room.roomId}', due to:\n${e.stack}`);
      }
    }
  }
}

export async function getPreviousProcessId(hostname: string = '') {
  return await presence.hget(getProcessRestoreKey(), hostname);
}

export function getRoomRestoreListKey() {
  return 'roomhistory';
}

export function getProcessRestoreKey() {
  return 'processhistory';
}
