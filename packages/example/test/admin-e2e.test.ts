/**
 * End-to-end test of the admin panel against the running example server.
 *
 * Flow:
 *   1. Wipe colyseus.db (forces first-run state)
 *   2. Spawn `tsx src/app.config.ts`
 *   3. Wait for /admin-api/auth/status
 *   4. Open /admin/ in puppeteer → redirected to /setup
 *   5. Fill bootstrap form → admin created, cookie set, redirects to /
 *   6. Verify sidebar + at least one resource list renders
 *   7. POST /admin-api/configs with the bootstrap session — covers the
 *      "save row" path that previously 403'd before auth was real
 *   8. Click "Sign out" → redirected to /login
 *   9. Sign in again with the same credentials → success
 *  10. Tear down
 */
import assert from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser } from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.resolve(__dirname, '..');
const PORT = 2567;
const BASE = `http://localhost:${PORT}`;

let server: ChildProcess | null = null;
let browser: Browser | null = null;

const BOOTSTRAP_EMAIL = 'admin@example.com';
const BOOTSTRAP_PASSWORD = 'correct-horse-battery';

function wipeDb() {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(path.join(exampleDir, `colyseus.db${ext}`)); } catch { /* ignore */ }
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await predicate()) { return; } } catch { /* keep trying */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function serverReady(): Promise<boolean> {
  const res = await fetch(`${BASE}/admin-api/auth/status`).catch(() => null);
  return !!res && res.ok;
}

before(async () => {
  wipeDb();
  server = spawn('pnpm', ['start'], {
    cwd: exampleDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  // Surface startup failures
  server.stderr?.on('data', (chunk) => {
    const s = chunk.toString();
    if (s.includes('Error') || s.includes('error')) { process.stderr.write(`[server] ${s}`); }
  });
  await waitFor(serverReady);
  browser = await puppeteer.launch({ headless: true, protocolTimeout: 30_000 });
});

after(async () => {
  if (browser) { await browser.close(); }
  if (server) {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (!server.killed) { server.kill('SIGKILL'); }
  }
  wipeDb();
});

describe('admin e2e (auth + first-run + CRUD)', () => {
  it('GET /auth/status on fresh DB reports needsBootstrap: true', async () => {
    const res = await fetch(`${BASE}/admin-api/auth/status`);
    const body = await res.json();
    assert.equal(body.needsBootstrap, true);
    assert.equal(body.authenticated, false);
  });

  it('opening /admin/ as anonymous user redirects to /setup (first run)', async () => {
    const page = await browser!.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    page.on('pageerror', (e) => process.stderr.write(`[page error] ${e.message}\n`));
    await page.goto(`${BASE}/admin/`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForSelector('[data-testid="setup-card"]', { timeout: 15_000 });
    } catch (err) {
      const url = page.url();
      const body = await page.evaluate(() => document.body.innerText.slice(0, 400));
      throw new Error(`expected /setup; URL=${url}; body=${body}`);
    }
    assert.match(page.url(), /\/admin\/setup$/);
    await page.close();
  });

  it('bootstrap form creates the first admin and signs them in', async () => {
    const page = await browser!.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    page.on('pageerror', (e) => process.stderr.write(`[page error] ${e.message}\n`));
    page.on('response', (r) => {
      if (r.url().includes('/admin-api') && r.status() >= 400) {
        process.stderr.write(`[admin-api ${r.status()}] ${r.url()}\n`);
      }
    });
    await page.goto(`${BASE}/admin/setup`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="setup-email"]');

    await page.type('input[data-testid="setup-email"]', BOOTSTRAP_EMAIL);
    await page.type('input[data-testid="setup-password"]', BOOTSTRAP_PASSWORD);
    await page.click('[data-testid="setup-submit"]');

    try {
      await page.waitForSelector('.ant-menu-item a[href$="/users"]', { timeout: 15_000 });
    } catch (err) {
      const url = page.url();
      const body = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '?');
      const menuCount = await page.$$eval('.ant-menu-item', (els) => els.length).catch(() => -1);
      const catalogJson = await page.evaluate(async () => {
        const r = await fetch('/admin-api', { credentials: 'include' });
        return { status: r.status, len: (await r.json()).length };
      }).catch((e) => ({ status: 'err', msg: String(e) }));
      const html = await page.content().catch(() => '?');
      throw new Error(`expected sidebar; URL=${url}; menuItems=${menuCount}; catalog=${JSON.stringify(catalogJson)};\nbody=${body}\n\nHTML(first 2500)=${html.slice(0, 2500)}`);
    }
    assert.match(page.url(), /\/admin\/?$/);
    await page.close();
  });

  it('GET /auth/status now reports needsBootstrap: false', async () => {
    const res = await fetch(`${BASE}/admin-api/auth/status`);
    const body = await res.json();
    assert.equal(body.needsBootstrap, false);
  });

  it('logged-in admin can list users (via session cookie)', async () => {
    const page = await browser!.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    // Re-use the session by signing in
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-email"]');
    await page.type('input[data-testid="login-email"]', BOOTSTRAP_EMAIL);
    await page.type('input[data-testid="login-password"]', BOOTSTRAP_PASSWORD);
    await page.click('[data-testid="login-submit"]');

    // Login lands on /. Click the users menu item to navigate to the list.
    await page.waitForSelector('.ant-menu-item a[href$="/users"]', { timeout: 15_000 });
    await page.click('.ant-menu-item a[href$="/users"]');

    await page.waitForSelector('[data-testid="list-users"] .ant-table-row', { timeout: 10_000 });
    const rowIds = await page.$$eval(
      '[data-testid="list-users"] .ant-table-row',
      (rows) => rows.map((r) => r.getAttribute('data-row-id')).filter(Boolean) as string[],
    );
    assert.ok(rowIds.length >= 1, 'users table should contain at least the bootstrap admin');
    await page.close();
  });

  it('sign-out clears the cookie and redirects to /login', async () => {
    const page = await browser!.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-email"]');
    await page.type('input[data-testid="login-email"]', BOOTSTRAP_EMAIL);
    await page.type('input[data-testid="login-password"]', BOOTSTRAP_PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('[data-testid="logout-button"]', { timeout: 10_000 });

    await page.click('[data-testid="logout-button"]');
    await page.waitForSelector('[data-testid="login-card"]', { timeout: 10_000 });
    assert.match(page.url(), /\/admin\/login$/);

    // Cookie should now reject API access
    const cookies = await page.cookies();
    const session = cookies.find((c) => c.name === 'colyseus_admin_session');
    // Some adapters delete via Max-Age=0; cookie may or may not still exist visibly.
    // The authoritative check is that the API returns 401:
    const res = await fetch(`${BASE}/admin-api/users`, {
      headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
    });
    assert.equal(res.status, 401, 'after logout, GET /admin-api/users should be 401');
    await page.close();
  });

  it('CRUD via cookie: create configs row through the API', async () => {
    // Re-login to get a fresh cookie for the fetch
    const loginRes = await fetch(`${BASE}/admin-api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    });
    const setCookie = loginRes.headers.get('set-cookie')!;
    const cookieHeader = setCookie.split(';')[0]; // just colyseus_admin_session=...

    const create = await fetch(`${BASE}/admin-api/configs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({ key: 'double_xp', value: 'on' }),
    });
    assert.equal(create.status, 201, `POST /configs should be 201 (got ${create.status})`);

    const get = await fetch(`${BASE}/admin-api/configs/double_xp`, {
      headers: { cookie: cookieHeader },
    });
    assert.equal(get.status, 200);
    const row = await get.json();
    assert.equal(row.key, 'double_xp');
  });

  it('bootstrap is one-shot — second call returns 403', async () => {
    const res = await fetch(`${BASE}/admin-api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'second@x.com', password: 'whatever' }),
    });
    assert.equal(res.status, 403);
  });

  it('catalog reflects custom columns spread onto the users table', async () => {
    // app.config.ts customizes the users table with `display_name` + `level`.
    // The catalog endpoint should surface them so the admin UI can render them.
    const res = await fetch(`${BASE}/admin-api`);
    assert.equal(res.status, 200);
    const catalog = await res.json() as Array<{ name: string; columns: Array<{ name: string }> }>;
    const usersResource = catalog.find((r) => r.name === 'users');
    assert.ok(usersResource, 'users resource should be in the catalog');
    const colNames = usersResource!.columns.map((c) => c.name);
    assert.ok(colNames.includes('display_name'),
      `users.columns should include display_name, got: ${colNames.join(', ')}`);
    assert.ok(colNames.includes('level'),
      `users.columns should include level, got: ${colNames.join(', ')}`);
    // Sanity: built-in columns still present
    assert.ok(colNames.includes('email'), 'built-in email column should still be there');
  });

  it('admin UI table renders custom column headers', async () => {
    const page = await browser!.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-email"]');
    await page.type('input[data-testid="login-email"]', BOOTSTRAP_EMAIL);
    await page.type('input[data-testid="login-password"]', BOOTSTRAP_PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('.ant-menu-item a[href$="/users"]', { timeout: 15_000 });
    await page.click('.ant-menu-item a[href$="/users"]');
    await page.waitForSelector('[data-testid="list-users"] .ant-table-thead', { timeout: 10_000 });

    const headers = await page.$$eval(
      '[data-testid="list-users"] .ant-table-thead .ant-table-cell',
      (cells) => cells.map((c) => (c.textContent ?? '').trim()),
    );
    assert.ok(headers.includes('display_name'),
      `expected display_name header, got: ${headers.join(', ')}`);
    assert.ok(headers.includes('level'),
      `expected level header, got: ${headers.join(', ')}`);
    await page.close();
  });
});
