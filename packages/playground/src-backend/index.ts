import path from 'path';
import { fileURLToPath } from 'url';
import { createEndpoint, matchMaker, Server, type IRoomCache, type Endpoint } from '@colyseus/core';
import { auth, JWT } from '@colyseus/auth';
import { applyMonkeyPatch } from './colyseus.ext.js';
import { serveStatic } from './serve-static.js';

export type AuthConfig = {
  oauth: string[],
  register: boolean,
  anonymous: boolean,
};

export interface PlaygroundOptions {
  /** Mount prefix. Defaults to `''` (root). e.g. `'/playground'`. */
  prefix?: string;
  /** Better-call middleware applied to every playground endpoint — use for auth gating. */
  use?: any[];
}

const SPA_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');

export function playground(opts: PlaygroundOptions = {}): Record<string, Endpoint> {
  // Side effect: install the per-room message-types announcement used by the
  // playground UI. Fire-and-forget — the patch is idempotent.
  applyMonkeyPatch();

  const prefix = opts.prefix ?? '';
  const use = opts.use ?? [];

  return {
    'playground-rooms': createEndpoint(`${prefix}/rooms`, { method: 'GET', use }, async () => {
      const rooms = await matchMaker.driver.query({});
      const roomsByType: Record<string, number> = {};
      const roomsById: Record<string, IRoomCache> = {};
      rooms.forEach((room) => {
        roomsByType[room.name] = (roomsByType[room.name] ?? 0) + 1;
        roomsById[room.roomId] = room;
      });
      return {
        rooms: Object.keys(matchMaker.getAllHandlers()),
        roomsByType,
        roomsById,
        auth: {
          oauth: Object.keys(auth.oauth.providers),
          register: typeof auth.settings.onRegisterWithEmailAndPassword === 'function',
          anonymous: typeof JWT.settings.secret === 'string',
        } as AuthConfig,
      };
    }),

    'playground-apidocs': createEndpoint(`${prefix}/__apidocs`, { method: 'GET', use }, async () => {
      let z: any;
      try { z = await import('zod'); } catch { /* zod is an optional peer */ }

      // Read the live router's endpoints at request time — by now the Server
      // has been constructed and the router has every extension applied
      // (user routes + auth/database/default routes).
      const endpoints: Record<string, any> = (Server.current?.router as any)?.endpoints ?? {};
      return Object.values(endpoints).map((endpoint: any) => ({
        method: endpoint.options.method,
        path: endpoint.path,
        body: z && endpoint.options.body && z.toJSONSchema(endpoint.options.body),
        query: z && endpoint.options.query && z.toJSONSchema(endpoint.options.query),
        metadata: endpoint.options.metadata,
        description: endpoint.options.metadata?.openapi?.description,
      }));
    }),

    'playground-index': createEndpoint(`${prefix}/`, { method: 'GET', use }, async () => {
      return serveStatic(SPA_DIST, '');
    }),

    'playground-static': createEndpoint(`${prefix}/**:splat`, { method: 'GET', use }, async (ctx) => {
      return serveStatic(SPA_DIST, (ctx.params as any).splat);
    }),
  };
}
