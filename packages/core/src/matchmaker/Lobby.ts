import * as matchMaker from '../MatchMaker.js';

import type { Room } from '../Room.js';
import { IRoomCache } from './driver/api.js';

const LOBBY_CHANNEL = '$lobby';

/*
 * TODO: refactor this on v0.16
 *
 * Some users might be relying on "1" = "removed" from the lobby due to this workaround: https://github.com/colyseus/colyseus/issues/617
 * Though, for consistency, we should invert as "0" = "invisible" and "1" = "visible".
 *
 * - rename "removed" to "isVisible" and swap the logic
 * - emit "visibility-change" with inverted value (isVisible)
 * - update "subscribeLobby" to check "1" as "isVisible" instead of "removed"
 */

export function updateLobby(room: Room, removed: boolean = false) {
  const listing = room.listing;

  if (listing.unlisted) return;

  if (removed) {
    matchMaker.presence.publish(LOBBY_CHANNEL, `${listing.roomId},1`);
  } else if (!listing.private) {
    matchMaker.presence.publish(LOBBY_CHANNEL, `${listing.roomId},0`);
  }
}

export async function subscribeLobby(callback: (roomId: string, roomListing: IRoomCache) => void) {
  const cb = async (message) => {
    const [roomId, isRemove] = message.split(',');

    if (isRemove === '1') {
      callback(roomId, null);

    } else {
      const room = (await matchMaker.query({ roomId }))[0];
      callback(roomId, room);
    }
  };

  await matchMaker.presence.subscribe(LOBBY_CHANNEL, cb);

  return () => matchMaker.presence.unsubscribe(LOBBY_CHANNEL, cb);
}
