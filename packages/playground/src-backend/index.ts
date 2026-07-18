import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import inspector from 'node:inspector/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'http';
import { createEndpoint, dualModeEndpoints, isDevMode, logger, matchMaker, Server, type IRoomCache, type Endpoint } from '@colyseus/core';
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

// CPU profiling state — single process, single active session. The captured
// `.cpuprofile` and the cpupro-generated standalone HTML report are kept in
// memory (latest only); a process restart clears them, which is fine for a
// dev tool. See the `/profiling/*` endpoints below.
let profilingSession: inspector.Session | null = null;
let profilingStartedAt = 0;
let lastProfile: string | null = null;
let lastReportHtml: string | null = null;
let lastProfilingError: string | null = null;

// cpupro is an OPTIONAL peer dependency — it pulls in a native addon
// (v8-profiler-next) we don't use, so it's opt-in. Resolve its CLI bin if
// installed, else null. cpupro's `exports` map hides `bin/cpupro`, so resolve
// the package dir via its (exported) package.json and join the bin path.
function resolveCpuproBin(): string | null {
  try {
    const require = createRequire(import.meta.url);
    return path.join(path.dirname(require.resolve('cpupro/package.json')), 'bin', 'cpupro');
  } catch {
    return null;
  }
}

// Render an existing `.cpuprofile` (JSON string) into a standalone,
// self-contained cpupro HTML report by shelling out to the cpupro CLI. The
// CLI is the documented, format-stable path and is agnostic to our cjs/esm
// dual build.
async function generateCpuproReport(profileJson: string): Promise<string> {
  const bin = resolveCpuproBin();
  if (!bin) {
    throw new Error("cpupro is not installed — run `npm install cpupro` to render reports in the playground. The .cpuprofile is still available to download.");
  }
  const stamp = Date.now();
  const profilePath = path.join(os.tmpdir(), `colyseus-profile-${stamp}.cpuprofile`);
  const reportName = `colyseus-report-${stamp}.html`;
  const reportPath = path.join(os.tmpdir(), reportName);
  await fs.writeFile(profilePath, profileJson);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [bin, profilePath, '-n', '-o', os.tmpdir(), '-f', reportName], { stdio: 'ignore' });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`cpupro exited with code ${code}`)));
    });
    return patchCpuproReport(await fs.readFile(reportPath, 'utf8'));
  } finally {
    await fs.rm(profilePath, { force: true }).catch(() => {});
    await fs.rm(reportPath, { force: true }).catch(() => {});
  }
}

// cpupro@0.7.0 ships a `build/report.html` template configured to fetch its
// data from a sibling `model.data` URL (`dataSource:"url"`), yet `report.js`
// appends the actual profile inline as `discoveryLoader.push()` chunks — a
// mechanism only wired up when `dataSource==="push"`. As shipped the file is
// therefore not self-contained: it requests `model.data` (404s through our
// SPA) and throws `discoveryLoader is not defined`. Flip the data source to
// `push` so the embedded chunks are consumed and the report stands alone.
function patchCpuproReport(html: string): string {
  return html.replace(/dataSource:"url",data:[A-Za-z_$][\w$]*\.model\.data/, 'dataSource:"push",data:1');
}

export function playground(opts: PlaygroundOptions = {}) {
  applyMonkeyPatch();

  const prefix = opts.prefix ?? '';
  const use = opts.use ?? [];

  // Data endpoints leak internals (room listing + auth config, API schemas,
  // CPU profiles/stack frames). Open during local dev (devMode or a
  // non-production NODE_ENV); on production mounts require a `use:` guard —
  // the guard is the opt-in. 404 hides the routes' existence.
  let warnedGuardedProd = false;
  const guardedDenied = () => {
    if (isDevMode || process.env.NODE_ENV !== 'production') { return null; }
    if (use.length === 0) { return new Response('Not found', { status: 404 }); }
    if (!warnedGuardedProd) {
      warnedGuardedProd = true;
      logger.warn('@colyseus/playground: serving in production behind `use:` middleware — make sure at least one enforces authentication.');
    }
    return null;
  };

  const endpoints: Record<string, Endpoint> = {
    'playground-rooms': createEndpoint(`${prefix}/rooms`, { method: 'GET', use }, async () => {
      const denied = guardedDenied(); if (denied) { return denied; }
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
      const denied = guardedDenied(); if (denied) { return denied; }

      let z: any;
      try { z = await import('zod'); } catch { /* zod is an optional peer */ }
      const routerEndpoints: Record<string, any> = (Server.current?.router as any)?.endpoints ?? {};
      return Object.values(routerEndpoints)
        // SERVER_ONLY endpoints aren't routable — don't list them either
        .filter((endpoint: any) => !endpoint.options.metadata?.SERVER_ONLY)
        .map((endpoint: any) => ({
          method: endpoint.options.method,
          path: endpoint.path,
          body: z && endpoint.options.body && z.toJSONSchema(endpoint.options.body),
          query: z && endpoint.options.query && z.toJSONSchema(endpoint.options.query),
          metadata: endpoint.options.metadata,
          description: endpoint.options.metadata?.openapi?.description,
        }));
    }),

    'profiling-start': createEndpoint(`${prefix}/profiling/start`, { method: 'POST', use }, async (ctx) => {
      const denied = guardedDenied(); if (denied) { return denied; }
      if (profilingSession) {
        return { status: 'running', startedAt: profilingStartedAt, error: 'already running' };
      }
      const interval = Number((ctx.query as any)?.interval) || 100;
      const session = new inspector.Session();
      session.connect();
      await session.post('Profiler.enable');
      await session.post('Profiler.setSamplingInterval', { interval });
      await session.post('Profiler.start');
      profilingSession = session;
      profilingStartedAt = Date.now();
      lastProfile = null;
      lastReportHtml = null;
      lastProfilingError = null;
      return { status: 'started', startedAt: profilingStartedAt, interval };
    }),

    'profiling-stop': createEndpoint(`${prefix}/profiling/stop`, { method: 'POST', use }, async () => {
      const denied = guardedDenied(); if (denied) { return denied; }
      if (!profilingSession) {
        return { status: 'idle', error: 'not running' };
      }
      const session = profilingSession;
      profilingSession = null;
      const durationMs = Date.now() - profilingStartedAt;
      const { profile } = await session.post('Profiler.stop');
      session.disconnect();
      lastProfile = JSON.stringify(profile);
      lastReportHtml = null;
      lastProfilingError = null;
      try {
        lastReportHtml = await generateCpuproReport(lastProfile);
      } catch (e: any) {
        lastProfilingError = e?.message ?? String(e);
      }
      return {
        status: 'stopped',
        durationMs,
        profileBytes: lastProfile.length,
        reportReady: !!lastReportHtml,
        error: lastProfilingError,
      };
    }),

    'profiling-status': createEndpoint(`${prefix}/profiling/status`, { method: 'GET', use }, async () => {
      const denied = guardedDenied(); if (denied) { return denied; }
      return {
        running: !!profilingSession,
        startedAt: profilingSession ? profilingStartedAt : 0,
        hasProfile: !!lastProfile,
        hasReport: !!lastReportHtml,
        // false when the optional `cpupro` peer dep isn't installed — the UI
        // uses this to warn up front that captures are download-only.
        reportSupported: !!resolveCpuproBin(),
        error: lastProfilingError,
      };
    }),

    'profiling-profile': createEndpoint(`${prefix}/profiling/profile.cpuprofile`, { method: 'GET', use }, async () => {
      const denied = guardedDenied(); if (denied) { return denied; }
      if (!lastProfile) { return new Response('No profile captured', { status: 404 }); }
      const buf = Buffer.from(lastProfile, 'utf8');
      return new Response(new Uint8Array(buf) as any, {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(buf.length),
          'content-disposition': 'attachment; filename="profile.cpuprofile"',
          'cache-control': 'no-cache',
          // serve-static.ts sets this for the same reason: better-call's node
          // adapter doesn't call res.end() on a backpressured single-chunk
          // body, so a keep-alive response is left unterminated and browsers
          // spin. Closing the connection terminates it cleanly.
          'connection': 'close',
        },
      });
    }),

    'profiling-report': createEndpoint(`${prefix}/profiling/report.html`, { method: 'GET', use }, async () => {
      const denied = guardedDenied(); if (denied) { return denied; }
      if (!lastReportHtml) { return new Response('No report available', { status: 404 }); }
      const buf = Buffer.from(lastReportHtml, 'utf8');
      return new Response(new Uint8Array(buf) as any, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-length': String(buf.length),
          'cache-control': 'no-cache',
          // see profiling-profile above — `connection: close` so the browser
          // doesn't spin on better-call's unterminated keep-alive response.
          'connection': 'close',
        },
      });
    }),

    'playground-index': createEndpoint(`${prefix}/`, { method: 'GET', use }, async () => {
      return serveStatic(SPA_DIST, '');
    }),

    'playground-static': createEndpoint(`${prefix}/**:splat`, { method: 'GET', use }, async (ctx) => {
      return serveStatic(SPA_DIST, (ctx.params as any).splat);
    }),
  };

  const SPA_DIST_RESOLVED = path.resolve(SPA_DIST);

  return dualModeEndpoints(endpoints, {
    catchAllKey: 'playground-static',
    buildMiddleware: ({ fullHandler }) => {
      // Strip express's `baseUrl` so the inner router sees the request
      // relative to its mount point — playground's endpoint paths assume
      // a `''` prefix, so a sub-mount like `app.use("/foo", playground())`
      // needs the leading `/foo` stripped before dispatch.
      const dispatch = (req: IncomingMessage, res: ServerResponse, next: (e?: any) => void) => {
        const stripped = Object.create(req, {
          baseUrl: { value: '', enumerable: true, configurable: true },
          originalUrl: { value: req.url, enumerable: true, configurable: true },
        });
        fullHandler(stripped as any, res as any).catch(next);
      };

      return (req, res, next) => {
        const url = (req.url ?? '').split('?')[0]!;
        const isProfiling = url.startsWith('/profiling');

        // Profiling start/stop are POSTs; everything else here is GET-only.
        if (req.method === 'POST') {
          return isProfiling ? dispatch(req, res, next) : next();
        }
        if (req.method !== 'GET') { return next(); }

        if (url === '/' || url === '/rooms' || url === '/__apidocs' || isProfiling) {
          return dispatch(req, res, next);
        }

        // Asset request — only delegate if the file actually exists on
        // disk. Avoids the catch-all's SPA fallback (which would serve
        // index.html for unknown paths, masking sibling express routes).
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
    },
  });
}
