import debug from 'debug';
import { type Schema, MapSchema, ArraySchema, SetSchema, CollectionSchema, $childType } from '@colyseus/schema';
import { logger } from '../Logger.ts';
import { debugAndPrintError } from '../Debug.ts';
import { getLocalRoomById, handleCreateRoom, presence, remoteRoomCall } from '../MatchMaker.ts';
import type { Room } from '../Room.ts';

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

    // Restore previous state
    if (roomHistory.hasOwnProperty("state")) {
      try {
        const rawState = JSON.parse(roomHistory.state);
        logger.debug(`📋 room '${roomId}' state =>`, rawState);

        restoreFromJSON(recreatedRoom.state, rawState);
      } catch (e: any) {
        debugAndPrintError(`❌ couldn't restore room '${roomId}' state:\n${e.stack}`);
      }
    }

    // Reserve seats for clients from cached history
    if (roomHistory.clients) {
      for (const clientData of roomHistory.clients) {
        // TODO: need to restore each client's StateView as well
        // reserve seat for 20 seconds
        const { sessionId, reconnectionToken } = clientData;
        await remoteRoomCall(recreatedRoomListing.roomId, '_reserveSeat', [sessionId, {}, {}, 20, true, reconnectionToken]);
      }
    }

    // call `onRestoreRoom` with custom 'cache'd property.
    recreatedRoom.onRestoreRoom?.(roomHistory["cache"]);

    logger.debug(`🔄 room '${roomId}' has been restored with ${roomHistory.clients?.length || 0} reserved seats.`);
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
        }

        // cache active clients with their reconnection tokens
        // TODO: need to cache each client's StateView as well
        const activeClients = room.clients.map((client) => ({
          sessionId: client.sessionId,
          reconnectionToken: client.reconnectionToken,
        }));

        // also cache reserved seats (they don't have reconnectionTokens yet)
        const reservedSeats = Object.keys(room['_reservedSeats']).map((sessionId) => ({
          sessionId,
          reconnectionToken: undefined,
        }));

        roomHistory["clients"] = activeClients.concat(reservedSeats);

        await presence.hset(getRoomRestoreListKey(), room.roomId, JSON.stringify(roomHistory));

        // Rewrite updated room history
        logger.debug(`💾 caching room '${room.roomId}' (clients: ${room.clients.length}, state size: ${(roomHistory["state"] || []).length} bytes)`);

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


// ..............................................................................
// Schema: restoreFromJSON()
// TODO: extract this into @colyseus/schema
// ..............................................................................

/**
 * Recursively converts raw JSON objects into proper Schema instances.
 * Handles MapSchema, ArraySchema, SetSchema, CollectionSchema, and nested Schema objects.
 *
 * @param schemaInstance - The Schema instance with proper type definitions
 * @param toJSONData - The raw JSON object to convert
 * @returns The processed data ready for .assign()
 */
export function restoreFromJSON<T extends Schema>(
  schemaInstance: T,
  toJSONData: Record<string, any>,
): T {
  const result: Record<string, any> = {};

  for (const key in toJSONData) {
    const rawValue = toJSONData[key];
    const schemaField = (schemaInstance as any)[key];

    if (rawValue === null || rawValue === undefined) {
      result[key] = rawValue;
      continue;
    }

    // Handle MapSchema fields
    if (schemaField instanceof MapSchema) {
      const ItemClass = getCollectionItemClass(schemaField);

      if (ItemClass && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        for (const mapKey in rawValue) {
          schemaField.set(mapKey, createSchemaInstance(ItemClass, rawValue[mapKey]));
        }
        continue;
      }
    }

    // Handle array-like collection fields (ArraySchema, SetSchema, CollectionSchema)
    if (
      schemaField instanceof ArraySchema ||
      schemaField instanceof SetSchema ||
      schemaField instanceof CollectionSchema
    ) {
      const ItemClass = getCollectionItemClass(schemaField);
      const addItem = schemaField instanceof ArraySchema
        ? (item: any) => schemaField.push(item)
        : (item: any) => schemaField.add(item);

      if (Array.isArray(rawValue)) {
        for (const itemData of rawValue) {
          addItem(ItemClass ? createSchemaInstance(ItemClass, itemData) : itemData);
        }
        continue;
      }
    }

    // Handle nested Schema objects
    if (schemaField && typeof schemaField === 'object' && schemaField.constructor !== Object && typeof schemaField.assign === 'function') {
      if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        const processedData = restoreFromJSON(schemaField, rawValue);
        schemaField.assign(processedData);
        continue;
      }
    }

    // Primitive value or unrecognized type - pass through
    result[key] = rawValue;
  }

  return schemaInstance.assign(result);
}

/**
 * Attempts to get the item class from a collection schema (MapSchema, ArraySchema, etc.)
 * Uses the schema's internal ~childType property to find the constructor.
 */
function getCollectionItemClass(collection: MapSchema | ArraySchema | SetSchema | CollectionSchema): (new (...args: any[]) => Schema) | null {
  try {
    // Access the child type via the internal ~childType property
    const childType = collection[$childType];
    if (childType && typeof childType === 'function') {
      return childType;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Creates a Schema instance from raw item data, recursively restoring nested structures.
 */
function createSchemaInstance(ItemClass: new (...args: any[]) => Schema, itemData: any): Schema {
  const itemInstance = new ItemClass();

  if (typeof itemData === 'object' && itemData !== null) {
    const processedItemData = restoreFromJSON(itemInstance, itemData);
    itemInstance.assign(processedItemData);
  } else {
    itemInstance.assign(itemData);
  }

  return itemInstance;
}