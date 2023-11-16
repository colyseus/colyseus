import { presence, processId } from "./MatchMaker";

export type Stats = {
  roomCount: number;
  ccu: number;
}

export let local: Stats = {
  roomCount: 0,
  ccu: 0,
};

export async function fetchAll() {
  // TODO: cache this value to avoid querying too often
  const allStats: Array<Stats & { processId: string }> = [];
  const allProcesses = await presence.hgetall(getRoomCountKey());
  for (let remoteProcessId in allProcesses) {
    if (remoteProcessId === processId) {
      allStats.push({ processId, roomCount: local.roomCount, ccu: local.ccu, });

    } else {
      const [roomCount, ccu] = allProcesses[remoteProcessId].split(',').map(Number);
      allStats.push({ processId: remoteProcessId, roomCount, ccu });
    }
  }
  return allStats;
}

let lastPersisted = 0;
let persistTimeout = undefined;
const persistInterval = 1000;

export function persist() {
  /**
   * Avoid persisting too often.
   */
  const now = Date.now();

  if (now - lastPersisted > persistInterval) {
    lastPersisted = now;
    return presence.hset(getRoomCountKey(), processId, `${local.roomCount},${local.ccu}`);

  } else {
    clearTimeout(persistTimeout);
    persistTimeout = setTimeout(persist, persistInterval);
  }
}

export function reset() {
  lastPersisted = 0;
  clearTimeout(persistTimeout);
  local.roomCount = 0;
  local.ccu = 0;
  return persist();
}

export function excludeProcess(_processId: string) {
  return presence.hdel(getRoomCountKey(), _processId);
}

export async function getGlobalCCU() {
  const allStats = await fetchAll();
  return allStats.reduce((prev, next) => prev + next.ccu, 0);
}

function getRoomCountKey() {
  return 'roomcount';
}