import path from 'path';
import { z } from 'zod';
import { createEndpoint, dualModeEndpoints, matchMaker, type Endpoint } from '@colyseus/core';
import { OSUtils } from 'node-os-utils';

import { serveStatic } from './serve-static.js';
import './ext/Room.js';

const osutils = new OSUtils();
const UNAVAILABLE_ROOM_ERROR = "@colyseus/monitor: room $roomId is not available anymore.";
const SPA_DIST = path.resolve(import.meta.dirname, '..', 'build', 'static');

export interface MonitorOptions {
  /** Endpoint path prefix — namespaces the routes when spread into `createRouter`, honored at root express mounts. Under a path mount (`app.use("/stats", monitor())`) the mount path takes over. Defaults to `'/monitor'`. */
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

export function monitor(opts: MonitorOptions = {}) {
  const prefix = opts.prefix ?? '/monitor';
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

  return dualModeEndpoints(endpoints, {
    catchAllKey: 'monitor-static',
    prefix,
    staticDir: SPA_DIST,
  });
}
