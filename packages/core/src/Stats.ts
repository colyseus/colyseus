import { MatchMakerState, presence, processId, state } from './MatchMaker.ts';

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

export function persist(forceNow: boolean = false) {
  // skip if shutting down
  if (state === MatchMakerState.SHUTTING_DOWN) {
    return;
  }

  /**
   * Avoid persisting more than once per second.
   */
  const now = Date.now();

  if (forceNow || (now - lastPersisted > persistInterval)) {
    lastPersisted = now;
    return presence.hset(getRoomCountKey(), processId, `${local.roomCount},${local.ccu}`);

  } else {
    clearTimeout(persistTimeout);
    persistTimeout = setTimeout(persist, persistInterval);
  }
}

export function reset(_persist: boolean = true) {
  local.roomCount = 0;
  local.ccu = 0;

  if (_persist) {
    lastPersisted = 0;
    clearTimeout(persistTimeout);
    persist();
  }

  //
  // Attach local metrics to PM2 (if available)
  //
  import('@pm2/io').then((io) => {
    io.default.metric({ id: 'app/stats/ccu', name: 'ccu', value: () => local.ccu });
    io.default.metric({ id: 'app/stats/roomcount', name: 'roomcount', value: () => local.roomCount });
  }).catch(() => { });
}

export function excludeProcess(_processId: string) {
  return presence.hdel(getRoomCountKey(), _processId);
}

export async function getGlobalCCU() {
  const allStats = await fetchAll();
  return allStats.reduce((prev, next) => prev + next.ccu, 0);
}

/**
 * Auto-persist every minute.
 */
let autoPersistInterval = undefined;

export function setAutoPersistInterval() {
  const interval = 60 * 1000;// 1 minute

  autoPersistInterval = setInterval(() => {
    const now = Date.now();

    if (now - lastPersisted > interval) {
      persist();
    }
  }, interval);
}

export function clearAutoPersistInterval() {
  clearInterval(autoPersistInterval);
}

function getRoomCountKey() {
  return 'roomcount';
}