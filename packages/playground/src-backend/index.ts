import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IncomingMessage, ServerResponse } from 'http';
import { createEndpoint, createRouter, matchMaker, Server, toNodeHandler, type IRoomCache, type Endpoint } from '@colyseus/core';
import { auth, JWT } from '@colyseus/auth';
import { applyMonkeyPatch } from './colyseus.ext.js';
import { serveStatic } from './serve-static.js';

export type AuthConfig = {
  oauth: string[],
  register: boolean,
  anonymous: boolean,
};

export interface PlaygroundOptions {
  /** Mount prefix used when spread into `createRouter`. Ignored in express-middleware mode (express strips its mount path). Defaults to `''`. */
  prefix?: string;
  /** Better-call middleware applied to every playground endpoint — use for auth gating. */
  use?: any[];
}

const SPA_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');

type ExpressMiddleware = (req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => void;
type PlaygroundResult = ExpressMiddleware & Record<string, Endpoint>;

export function playground(opts: PlaygroundOptions = {}): PlaygroundResult {
  applyMonkeyPatch();

  const prefix = opts.prefix ?? '';
  const use = opts.use ?? [];

  // Better-call endpoints — for `routes: createRouter({ ...playground() })`.
  const endpoints: Record<string, Endpoint> = {
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

  // Express compatibility — `app.use("/", playground())` still works.
  // The middleware dispatches specific playground routes (/, /rooms,
  // /__apidocs) through a local better-call router, and serves asset files
  // only if they exist on disk. Unmatched requests fall through to next() so
  // sibling express routes keep working — matches the legacy express.static
  // semantics. The /**:splat SPA fallback is intentionally NOT applied here;
  // use the createRouter spread form if you want that behavior.
  const localRouter = createRouter({
    'playground-rooms': endpoints['playground-rooms']!,
    'playground-apidocs': endpoints['playground-apidocs']!,
    'playground-index': endpoints['playground-index']!,
    'playground-static': endpoints['playground-static']!,
  });
  const localHandler = toNodeHandler(localRouter.handler);
  const SPA_DIST_RESOLVED = path.resolve(SPA_DIST);

  // Strip express's `baseUrl` so the local router sees the request relative
  // to its mount point (better-call's getRequest builds the URL as
  // baseUrl + url, which would prefix mount path like `/playground/rooms`).
  const dispatch = (req: IncomingMessage, res: ServerResponse, next: (e?: any) => void) => {
    const stripped = Object.create(req, {
      baseUrl: { value: '', enumerable: true, configurable: true },
      originalUrl: { value: req.url, enumerable: true, configurable: true },
    });
    localHandler(stripped as any, res as any).catch(next);
  };

  const middleware: ExpressMiddleware = (req, res, next) => {
    if (req.method !== 'GET') { return next(); }
    const url = (req.url ?? '').split('?')[0]!;

    if (url === '/' || url === '/rooms' || url === '/__apidocs') {
      return dispatch(req, res, next);
    }

    // Asset request — only delegate if the file actually exists on disk.
    // Avoids the catch-all's SPA fallback (which would serve index.html for
    // every unknown path, masking sibling routes).
    const rel = url.replace(/^\/+/, '');
    if (!rel || rel.includes('..')) { return next(); }
    const filePath = path.resolve(SPA_DIST_RESOLVED, rel);
    if (!filePath.startsWith(SPA_DIST_RESOLVED + path.sep)) { return next(); }

    fs.stat(filePath).then((stat) => {
      if (stat.isFile()) {
        dispatch(req, res, next);
      } else {
        next();
      }
    }).catch(() => next());
  };

  // Attach endpoint properties so `{ ...playground() }` spreads them into
  // createRouter. JS `{...fn}` copies enumerable own properties of fn.
  return Object.assign(middleware, endpoints) as PlaygroundResult;
}
