// @vitest-environment node
/**
 * dualModeEndpoints' default express middleware — the shared layer behind
 * @colyseus/monitor and @colyseus/playground. Express strips a path mount
 * into `req.baseUrl` while the endpoint map keeps its configured prefix, so
 * the middleware must rebase requests onto the endpoint namespace and
 * canonicalize the bare index URL (the SPAs reference assets relatively).
 *
 * Matrix: {path mount, root mount, nested mount, '' prefix} ×
 * {bare, slash, api, asset, fall-through}.
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEndpoint, createRouter, dualModeEndpoints, type Endpoint } from '../src/router/index.ts';

function makePanel(prefix: string, staticDir: string) {
  const endpoints: Record<string, Endpoint> = {
    'panel-api': createEndpoint(`${prefix}/api`, { method: 'GET' }, async (ctx) =>
      ({ ok: true, echo: (ctx.query as any)?.echo ?? null })),
    'panel-act': createEndpoint(`${prefix}/act`, { method: 'POST' }, async () => ({ done: true })),
    'panel-index': createEndpoint(`${prefix}/`, { method: 'GET' }, async () =>
      new Response('<html>index</html>', { status: 200, headers: { 'content-type': 'text/html' } })),
    'panel-static': createEndpoint(`${prefix}/**:splat`, { method: 'GET' }, async (ctx) =>
      new Response(`asset:${(ctx.params as any).splat}`, { status: 200 })),
  };
  return dualModeEndpoints(endpoints, { catchAllKey: 'panel-static', prefix, staticDir });
}

let server: http.Server;
let base: string;
let staticDir: string;

beforeAll(async () => {
  staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-mode-static-'));
  fs.writeFileSync(path.join(staticDir, 'app.js'), 'console.log("app")');

  const app = express();
  app.use('/stats', makePanel('/panel', staticDir));       // path mount ≠ prefix
  app.use('/pg', makePanel('', staticDir));                // '' prefix (playground shape)
  const sub = express.Router();
  sub.use('/b', makePanel('/panel', staticDir));
  app.use('/a', sub);                                      // nested mount
  app.get('/stats/extra', (_req, res) => { res.send('sibling'); });
  app.use(makePanel('/panel', staticDir));                 // pathless root mount

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as any).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
  fs.rmSync(staticDir, { recursive: true, force: true });
});

const get = (p: string, init?: RequestInit) => fetch(base + p, { redirect: 'manual', ...init });

describe('path mount ≠ prefix — app.use("/stats", panel({ prefix: "/panel" }))', () => {
  it('bare mount path 302s to the trailing-slash URL', async () => {
    const res = await get('/stats');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/stats/');
  });

  it('preserves the query string on redirect', async () => {
    const res = await get('/stats?x=1');
    expect(res.headers.get('location')).toBe('/stats/?x=1');
  });

  it('serves the index at the canonical URL', async () => {
    const res = await get('/stats/');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>index</html>');
  });

  it('dispatches specific routes, query included', async () => {
    const res = await get('/stats/api?echo=hi');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, echo: 'hi' });
  });

  it('serves catch-all assets that exist on disk', async () => {
    const res = await get('/stats/app.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('asset:app.js');
  });

  it('falls through for unknown paths — sibling express routes stay reachable', async () => {
    expect(await (await get('/stats/extra')).text()).toBe('sibling');
    expect((await get('/stats/missing.js')).status).toBe(404);
  });

  it('dispatches non-GET routes by method', async () => {
    const res = await get('/stats/act', { method: 'POST' });
    expect(await res.json()).toEqual({ done: true });
    // no POST route at /api, no redirect for POST at the bare path
    expect((await get('/stats/api', { method: 'POST' })).status).toBe(404);
    expect((await get('/stats', { method: 'POST' })).status).toBe(404);
  });
});

describe('root mount — app.use(panel({ prefix: "/panel" }))', () => {
  it('bare prefix 302s, canonical serves', async () => {
    const bare = await get('/panel');
    expect(bare.status).toBe(302);
    expect(bare.headers.get('location')).toBe('/panel/');
    expect((await get('/panel/')).status).toBe(200);
    expect((await get('/panel/api')).status).toBe(200);
  });
});

describe("'' prefix — app.use('/pg', panel({ prefix: '' }))", () => {
  it('bare mount path 302s, canonical serves', async () => {
    const bare = await get('/pg');
    expect(bare.status).toBe(302);
    expect(bare.headers.get('location')).toBe('/pg/');
    expect((await get('/pg/')).status).toBe(200);
    expect((await get('/pg/api')).status).toBe(200);
  });
});

describe('nested routers — sub.use("/b", panel) under app.use("/a", sub)', () => {
  it('redirect derives from originalUrl, so nesting works', async () => {
    const bare = await get('/a/b');
    expect(bare.status).toBe(302);
    expect(bare.headers.get('location')).toBe('/a/b/');
    expect((await get('/a/b/')).status).toBe(200);
  });
});

describe('router mode — createRouter({ ...panel })', () => {
  it('serves the canonical URL; the bare path stays a protective 404', async () => {
    const router = createRouter(makePanel('/panel', staticDir) as any);
    const canonical = await router.handler(new Request('http://localhost/panel/'));
    expect(canonical.status).toBe(200);
    // rou3 normalizes trailing slashes but better-call exact-matches — the
    // 404 keeps the index from rendering blank at the slash-less URL.
    const bare = await router.handler(new Request('http://localhost/panel'));
    expect(bare.status).toBe(404);
  });
});
