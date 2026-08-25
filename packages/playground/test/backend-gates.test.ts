// @vitest-environment node
/**
 * Playground data endpoints (/rooms, /__apidocs, /profiling/*) leak internals,
 * so they are gated: open during local dev (devMode or a non-production
 * NODE_ENV), 404 on unguarded production mounts, and served on production
 * mounts only behind a `use:` guard (with a one-time auth reminder warning).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRouter, createMiddleware, Server, setDevMode } from '@colyseus/core';
import { APIError } from '@colyseus/better-call';
import { playground } from '../src-backend/index';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

const get = (router: any, path: string) =>
  router.handler(new Request(`http://localhost:2567${path}`));

// data endpoints only — the SPA catch-all would eat every path
function playgroundRouter(opts?: Parameters<typeof playground>[0]) {
  const { ['playground-static']: _catchAll, ...rest } = playground(opts) as any;
  const endpoints = Object.fromEntries(
    Object.entries(rest).filter(([, v]: any) => typeof v === 'function' && v.path),
  );
  return createRouter(endpoints as any);
}

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  setDevMode(false);
  vi.restoreAllMocks();
  Server.current = undefined;
});

describe('playground data endpoint gates', () => {
  it('production + unguarded: /rooms, /__apidocs and /profiling/* return 404', async () => {
    process.env.NODE_ENV = 'production';
    const router = playgroundRouter();
    for (const path of ['/rooms', '/__apidocs', '/profiling/status']) {
      const res = await get(router, path);
      expect(res.status, path).toBe(404);
    }
  });

  it('local dev (non-production NODE_ENV): /__apidocs is open', async () => {
    // vitest sets NODE_ENV=test — a non-production env counts as local dev
    const res = await get(playgroundRouter(), '/__apidocs');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]); // no Server.current → empty list
  });

  it('devMode opens the gate even under NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    setDevMode(true);
    const res = await get(playgroundRouter(), '/__apidocs');
    expect(res.status).toBe(200);
  });

  it('production + `use:` guard: served, SERVER_ONLY filtered, warns once', async () => {
    process.env.NODE_ENV = 'production';
    Server.current = {
      router: {
        endpoints: {
          visible: { path: '/visible', options: { method: 'GET', metadata: {} } },
          internal: { path: '/internal', options: { method: 'GET', metadata: { SERVER_ONLY: true } } },
        },
      },
    } as any;

    // core's default logger is console — capture the one-time auth reminder
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const guard = createMiddleware(async () => {});
    const router = playgroundRouter({ use: [guard] });

    const res1 = await get(router, '/__apidocs');
    expect(res1.status).toBe(200);
    const list = await res1.json();
    expect(list.map((e: any) => e.path)).toEqual(['/visible']);

    const res2 = await get(router, '/__apidocs');
    expect(res2.status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(1); // reminder fires once, not per request
  });

  it('production + `use:` guard rejecting: guard response wins', async () => {
    process.env.NODE_ENV = 'production';
    const deny = createMiddleware(async () => { throw new APIError(401, { message: 'unauthorized' }); });
    const res = await get(playgroundRouter({ use: [deny] }), '/__apidocs');
    expect(res.status).toBe(401);
  });
});
