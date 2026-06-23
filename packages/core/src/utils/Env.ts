import os from 'os';
import { LocalPresence } from '../presence/LocalPresence.ts';
import { LocalDriver, type MatchMakerDriver } from '../matchmaker/LocalDriver/LocalDriver.ts';
import { logger } from '../Logger.ts';
import type { Presence } from '../presence/Presence.ts';

export function isColyseusCloud(): boolean {
  return process.env.COLYSEUS_CLOUD !== undefined;
}

// On Colyseus Cloud, only opt into Redis when there's more than one CPU
// (multi-process deploys) or when REDIS_URI is explicitly provided.
// Single-CPU instances without REDIS_URI keep using Local presence/driver.
function shouldUseRedisOnCloud(): boolean {
  return os.cpus().length > 1 || process.env.REDIS_URI !== undefined;
}

export async function getDefaultPresence(): Promise<Presence> {
  if (isColyseusCloud() && shouldUseRedisOnCloud()) {
    try {
      const RedisPresence = await import('@colyseus/redis-presence');
      return new RedisPresence.RedisPresence(process.env.REDIS_URI);
    } catch (e) {
      console.error(e);
      logger.warn("");
      logger.warn("❌ could not initialize RedisPresence.");
      logger.warn("👉 npm install --save @colyseus/redis-presence");
      logger.warn("");
    }
  }
  return new LocalPresence();
}

export async function getDefaultDriver(): Promise<MatchMakerDriver> {
  if (isColyseusCloud() && shouldUseRedisOnCloud()) {
    try {
      const RedisDriver = await import('@colyseus/redis-driver');
      return new RedisDriver.RedisDriver(process.env.REDIS_URI);
    } catch (e) {
      console.error(e);
      logger.warn("");
      logger.warn("❌ could not initialize RedisDriver.");
      logger.warn("👉 npm install --save @colyseus/redis-driver");
      logger.warn("");
    }
  }
  return new LocalDriver();
}

export function getDefaultPublicAddress(): string | undefined {
  if (isColyseusCloud()) {
    let port = 2567;

    //
    // Multiple processes: Use NODE_APP_INSTANCE to play nicely with pm2
    //
    port += Number(process.env.NODE_APP_INSTANCE || "0");

    return process.env.SUBDOMAIN + "." + process.env.SERVER_NAME + "/" + port;

  } else {
    return undefined;
  }
}