import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IncomingMessage, ServerResponse } from 'http';
import { z } from 'zod';
import { createEndpoint, createRouter, matchMaker, toNodeHandler, type Endpoint } from '@colyseus/core';
import { OSUtils } from 'node-os-utils';

import { serveStatic } from './serve-static.js';
import './ext/Room.js';

const osutils = new OSUtils();
const UNAVAILABLE_ROOM_ERROR = "@colyseus/monitor: room $roomId is not available anymore.";
const SPA_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'static');

export interface MonitorOptions {
  /** Mount prefix used when spread into `createRouter`. Ignored in express-middleware mode. Defaults to `''`. */
  prefix?: string;
  /** Better-call middleware applied to every monitor endpoint — use for auth gating. */
  use?: any[];
  /** Columns shown in the rooms grid. */
  columns?: Array<
    'roomId' |
    'name' |
    'clients' |
    'maxClients' |
    'locked' |
    'elapsedTime' |
    { metadata: string } |
    'processId' |
    'publicAddress'
  >;
}

type ExpressMiddleware = (req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => void;
type MonitorResult = ExpressMiddleware & Record<string, Endpoint>;

export function monitor(opts: MonitorOptions = {}): MonitorResult {
  const prefix = opts.prefix ?? '';
  const use = opts.use ?? [];
  const columnsOpt = opts.columns;

  const endpoints: Record<string, Endpoint> = {
    'monitor-api-rooms': createEndpoint(`${prefix}/api`, { method: 'GET', use }, async () => {
      try {
        const rooms: any[] = await matchMaker.query({});
        const columns = columnsOpt ?? ['roomId', 'name', 'clients', 'maxClients', 'locked', 'elapsedTime'];

        if (!columnsOpt && rooms[0] && rooms[0].publicAddress !== undefined) {
          columns.push('publicAddress');
        }

        let connections = 0;
        const cpuUsage = await osutils.cpu.usage();
        const cpu = cpuUsage.success ? cpuUsage.data : NaN;
        const memoryInfo = await osutils.memory.info();
        const totalMemMb = memoryInfo.success ? memoryInfo.data.total?.toMB() : NaN;
        const usedMemMb = memoryInfo.success ? memoryInfo.data.used?.toMB() : NaN;

        return {
          columns,
          rooms: rooms.map((room) => {
            const data = JSON.parse(JSON.stringify(room));
            connections += room.clients;
            data.locked = room.locked || false;
            data.private = room.private;
            data.maxClients = `${room.maxClients}`;
            data.elapsedTime = Date.now() - new Date(room.createdAt).getTime();
            return data;
          }),
          connections,
          cpu,
          memory: { totalMemMb, usedMemMb },
        };
      } catch (e: any) {
        console.error(e.message);
        return new Response(JSON.stringify({ message: e.message }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    }),

    'monitor-api-room': createEndpoint(`${prefix}/api/room`, {
      method: 'GET',
      query: z.object({ roomId: z.string() }),
      use,
    }, async (ctx) => {
      const roomId = ctx.query.roomId;
      try {
        return await matchMaker.remoteRoomCall(roomId, 'getInspectData');
      } catch {
        return new Response(JSON.stringify({ message: UNAVAILABLE_ROOM_ERROR.replace('$roomId', roomId) }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    }),

    'monitor-api-room-call': createEndpoint(`${prefix}/api/room/call`, {
      method: 'GET',
      query: z.object({ roomId: z.string(), method: z.string(), args: z.string() }),
      use,
    }, async (ctx) => {
      const { roomId, method } = ctx.query;
      try {
        const args = JSON.parse(ctx.query.args);
        const data = await matchMaker.remoteRoomCall(roomId, method, args);
        return data ?? {};
      } catch {
        return new Response(JSON.stringify({ message: UNAVAILABLE_ROOM_ERROR.replace('$roomId', roomId) }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    }),

    'monitor-index': createEndpoint(`${prefix}/`, { method: 'GET', use }, async () => {
      return serveStatic(SPA_DIST, '');
    }),

    'monitor-static': createEndpoint(`${prefix}/**:splat`, { method: 'GET', use }, async (ctx) => {
      return serveStatic(SPA_DIST, (ctx.params as any).splat);
    }),
  };

  // Express compatibility — `app.use("/monitor", monitor())` still works.
  // The catch-all is intentionally excluded from the local router so unknown
  // paths fall through to express's next() (matches legacy express.static
  // behavior). The /**:splat SPA fallback is only used in createRouter
  // spread mode where it's the canonical mount point.
  const localRouter = createRouter({
    'monitor-api-rooms': endpoints['monitor-api-rooms']!,
    'monitor-api-room': endpoints['monitor-api-room']!,
    'monitor-api-room-call': endpoints['monitor-api-room-call']!,
    'monitor-index': endpoints['monitor-index']!,
  });
  const localHandler = toNodeHandler(localRouter.handler);
  const SPA_DIST_RESOLVED = path.resolve(SPA_DIST);

  // Strip express's `baseUrl` before dispatching to better-call so the local
  // router sees the request relative to its mount point (otherwise
  // `baseUrl + url` would yield e.g. `/monitor/api`, which the local router
  // doesn't have a route for).
  const dispatch = (req: IncomingMessage, res: ServerResponse, next: (e?: any) => void) => {
    const stripped = Object.create(req, {
      baseUrl: { value: '', enumerable: true, configurable: true },
      originalUrl: { value: req.url, enumerable: true, configurable: true },
    });
    localHandler(stripped as any, res as any).catch(next);
  };

  const middleware: ExpressMiddleware = (req, res, next) => {
    if (req.method !== 'GET') { return next(); }
    let url = (req.url ?? '').split('?')[0]!;
    // Normalize trailing slash (better-call doesn't auto-match `/api/` against `/api`).
    if (url.length > 1 && url.endsWith('/')) { url = url.slice(0, -1); }

    if (url === '/' || url === '' || url === '/api' || url === '/api/room' || url === '/api/room/call') {
      // If the original URL had a trailing slash that we stripped, rewrite
      // req.url so the inner router sees the normalized form.
      if (req.url && req.url.split('?')[0] !== url && req.url.split('?')[0]!.length > 1) {
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        (req as any).url = (url || '/') + qs;
      }
      return dispatch(req, res, next);
    }

    const rel = url.replace(/^\/+/, '');
    if (!rel || rel.includes('..')) { return next(); }
    const filePath = path.resolve(SPA_DIST_RESOLVED, rel);
    if (!filePath.startsWith(SPA_DIST_RESOLVED + path.sep)) { return next(); }

    fs.stat(filePath).then((stat) => {
      if (stat.isFile()) {
        // Build a one-off local router with the catch-all included so the
        // static endpoint can serve this asset.
        const fullLocal = createRouter(endpoints);
        const fullHandler = toNodeHandler(fullLocal.handler);
        const stripped = Object.create(req, {
          baseUrl: { value: '', enumerable: true, configurable: true },
          originalUrl: { value: req.url, enumerable: true, configurable: true },
        });
        fullHandler(stripped as any, res as any).catch(next);
      } else {
        next();
      }
    }).catch(() => next());
  };

  return Object.assign(middleware, endpoints) as MonitorResult;
}
