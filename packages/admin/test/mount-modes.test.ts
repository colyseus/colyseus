/**
 * Express mount modes — the admin() middleware must work at the root
 * (`app.use(admin())`) and under any path mount (`app.use("/x", admin())`),
 * where the mount takes over uiPath and the API nests at `${mount}${apiPath}`.
 * The served index.html gets the external coordinates injected so the
 * prebuilt SPA follows the mount.
 */
import assert from 'node:assert';
import { describe, it, before, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { GameDatabase } from '@colyseus/database';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'mount-modes-test-secret';
const { admin } = await import('../src-backend/index.ts');
const { externalUiConfig } = await import('../src-backend/internal/http.ts');

let db: GameDatabase;
let dbPath: string;
let distDir: string;

// Fake UI dist — keeps the test independent of the vite build, but mirrors its
// shape: relative asset URLs in <head>, which only resolve if <base> precedes them.
function makeDist(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-dist-'));
  fs.writeFileSync(path.join(dir, 'index.html'), [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <title>t</title>',
    '    <script type="module" crossorigin src="./assets/app.js"></script>',
    '    <link rel="stylesheet" crossorigin href="./assets/app.css">',
    '  </head>',
    '  <body><div id="root"></div></body>',
    '</html>',
  ].join('\n'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'assets', 'app.css'), 'body{}');
  return dir;
}

before(async () => {
  dbPath = path.join(os.tmpdir(), `admin-mount-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  db = new GameDatabase({ connectionString: dbPath });
  await db.boot();
  distDir = makeDist();
});

after(async () => {
  await db.shutdown();
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(dbPath + ext); } catch { /* ignore */ }
  }
  fs.rmSync(distDir, { recursive: true, force: true });
});

async function listen(setup: (app: express.Express) => void): Promise<{ server: Server; url: string }> {
  const app = express();
  setup(app);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${port}` };
}

function panel() {
  return admin({ database: db, uiDistDir: distDir, logger: null });
}

function injected(body: string): { base: string | null; api: string | null } {
  const cfg = body.match(/__COLYSEUS_ADMIN__=(\{[^<]*\})/);
  const parsed = cfg ? JSON.parse(cfg[1]!) : {};
  return { base: body.match(/<base href="([^"]*)"/)?.[1] ?? null, api: parsed.api ?? null };
}

/**
 * Resolve a served document's relative asset URLs the way a browser does, then
 * fetch them. Per spec only the first <base href> counts, and only for the
 * references that follow it — so a <base> emitted after the bundle tags makes
 * `/x/a/b` load `/x/a/b/assets/*` and every asset 404s.
 */
async function assertAssetsResolve(origin: string, pagePath: string) {
  const res = await fetch(`${origin}${pagePath}`);
  assert.strictEqual(res.status, 200, pagePath);
  const html = await res.text();
  const baseTag = /<base href="([^"]*)"/.exec(html);
  const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)];
  assert.ok(refs.length >= 2, `fixture lost its relative asset refs (${pagePath})`);
  for (const ref of refs) {
    const governs = baseTag && baseTag.index < ref.index;
    const from = governs ? new URL(baseTag[1]!, origin) : new URL(pagePath, origin);
    const resolved = new URL(ref[1]!, from);
    const asset = await fetch(resolved);
    assert.strictEqual(asset.status, 200, `${pagePath} resolved ${ref[1]} to ${resolved.pathname}`);
  }
}

/** Every depth a deep link can reach must serve a document whose assets resolve. */
async function assertDeepLinks(url: string, mount: string, base: string) {
  for (const suffix of ['', 'a', 'a/b', 'a/b/c']) {
    await assertAssetsResolve(url, `${mount}/${suffix}`);
    const body = await (await fetch(`${url}${mount}/${suffix}`)).text();
    assert.strictEqual(injected(body).base, base, `${mount}/${suffix}`);
  }
}

describe('root mount — app.use(admin())', () => {
  let server: Server, url: string;
  before(async () => { ({ server, url } = await listen((app) => app.use(panel()))); });
  after(() => server.close());

  it('302s the bare uiPath, preserving the query', async () => {
    const res = await fetch(`${url}/admin?a=1`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/admin/?a=1');
  });

  it('serves the index with the default coordinates injected', async () => {
    const res = await fetch(`${url}/admin/`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(injected(await res.text()), { base: '/admin/', api: '/admin-api' });
  });

  it('serves SPA deep links and assets', async () => {
    await assertDeepLinks(url, '/admin', '/admin/');
    const asset = await fetch(`${url}/admin/assets/app.js`);
    assert.strictEqual(asset.status, 200);
  });

  it('serves the API at the top-level apiPath', async () => {
    const res = await fetch(`${url}/admin-api/auth/status`);
    assert.strictEqual(res.status, 200);
  });

  it('honors a reverse-proxy x-forwarded-prefix in the injection', async () => {
    const res = await fetch(`${url}/admin/`, { headers: { 'x-forwarded-prefix': '/proxied' } });
    assert.deepStrictEqual(injected(await res.text()), { base: '/proxied/admin/', api: '/proxied/admin-api' });
  });

  it('ignores spoofed internal coordinate headers', async () => {
    const res = await fetch(`${url}/admin/`, {
      headers: { 'x-colyseus-admin-base': '"><script>x</script>', 'x-colyseus-admin-api': '/x' },
    });
    assert.strictEqual(injected(await res.text()).base, '/admin/');
  });
});

describe('path mount — app.use("/internal", admin())', () => {
  let server: Server, url: string;
  before(async () => {
    ({ server, url } = await listen((app) => {
      app.use('/internal', panel());
      app.get('/sibling', (_req, res) => { res.send('sibling-ok'); });
    }));
  });
  after(() => server.close());

  it('302s the bare mount path', async () => {
    const res = await fetch(`${url}/internal`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/internal/');
  });

  it('serves the index at the mount with mount coordinates injected', async () => {
    const res = await fetch(`${url}/internal/`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(injected(await res.text()), { base: '/internal/', api: '/internal/admin-api' });
  });

  it('serves SPA deep links and assets under the mount', async () => {
    await assertDeepLinks(url, '/internal', '/internal/');
    const asset = await fetch(`${url}/internal/assets/app.js`);
    assert.strictEqual(asset.status, 200);
  });

  it('nests the API inside the mount', async () => {
    const res = await fetch(`${url}/internal/admin-api/auth/status`);
    assert.strictEqual(res.status, 200);
  });

  it('leaves sibling express routes reachable', async () => {
    const res = await fetch(`${url}/sibling`);
    assert.strictEqual(await res.text(), 'sibling-ok');
  });

  it('composes a reverse-proxy prefix in front of the mount', async () => {
    const res = await fetch(`${url}/internal/`, { headers: { 'x-forwarded-prefix': '/proxied' } });
    assert.deepStrictEqual(injected(await res.text()), { base: '/proxied/internal/', api: '/proxied/internal/admin-api' });
  });

  it('drops a junk proxy prefix at write time — mount coordinates survive', async () => {
    const res = await fetch(`${url}/internal/`, { headers: { 'x-forwarded-prefix': '//evil.com' } });
    assert.deepStrictEqual(injected(await res.text()), { base: '/internal/', api: '/internal/admin-api' });
  });
});

describe('nested routers — sub.use("/b", admin()) under app.use("/a", sub)', () => {
  let server: Server, url: string;
  before(async () => {
    ({ server, url } = await listen((app) => {
      const sub = express.Router();
      sub.use('/b', panel());
      app.use('/a', sub);
    }));
  });
  after(() => server.close());

  it('derives the full mount from the accumulated baseUrl', async () => {
    const bare = await fetch(`${url}/a/b`, { redirect: 'manual' });
    assert.strictEqual(bare.headers.get('location'), '/a/b/');
    const res = await fetch(`${url}/a/b/`);
    assert.deepStrictEqual(injected(await res.text()), { base: '/a/b/', api: '/a/b/admin-api' });
    const api = await fetch(`${url}/a/b/admin-api/auth/status`);
    assert.strictEqual(api.status, 200);
  });
});

describe('externalUiConfig sanitization', () => {
  const paths = { uiPath: '/admin', apiPath: '/admin-api' };
  const headers = (map: Record<string, string>) => (k: string) => map[k] ?? null;

  it('rejects protocol-relative and non-path prefixes', () => {
    for (const bad of ['//evil.com', 'https://evil.com', '/a"b', '/a b', '/<x>']) {
      const cfg = externalUiConfig(headers({ 'x-forwarded-prefix': bad }), paths);
      assert.deepStrictEqual(cfg, { base: '/admin/', api: '/admin-api' }, bad);
    }
  });

  it('accepts a plain multi-segment prefix', () => {
    const cfg = externalUiConfig(headers({ 'x-forwarded-prefix': '/ops/game' }), paths);
    assert.deepStrictEqual(cfg, { base: '/ops/game/admin/', api: '/ops/game/admin-api' });
  });
});
