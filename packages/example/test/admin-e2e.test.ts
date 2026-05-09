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
      await page.waitForSelector('nav a[href$="/users"]', { timeout: 15_000 });
    } catch (err) {
      const url = page.url();
      const body = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '?');
      const menuCount = await page.$$eval('nav a[role="menuitem"]', (els) => els.length).catch(() => -1);
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

    // Login lands on /. Wait for the dashboard data to render before clicking
    // the menu — async re-renders can detach link nodes grabbed before settle.
    // Use evaluate-click to sidestep stale ElementHandle references.
    await page.waitForSelector('[data-testid="widget-recentUsers"]', { timeout: 15_000 });
    await page.waitForSelector('nav a[href$="/users"]', { timeout: 5_000 });
    await page.evaluate(() => {
      (document.querySelector('nav a[href$="/users"]') as HTMLAnchorElement).click();
    });

    await page.waitForSelector('[data-testid="list-users"] tbody tr[data-row-id]', { timeout: 10_000 });
    const rowIds = await page.$$eval(
      '[data-testid="list-users"] tbody tr[data-row-id]',
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
    await page.waitForSelector('[data-testid="widget-recentUsers"]', { timeout: 15_000 });
    await page.waitForSelector('[data-testid="logout-button"]', { timeout: 10_000 });

    // Click via evaluate to avoid stale handle on layout settle
    await page.evaluate(() => {
      (document.querySelector('[data-testid="logout-button"]') as HTMLButtonElement).click();
    });
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

  it('composite-PK row CRUD: GET / PATCH / DELETE work via base64url id', async () => {
    // cloudSaves has a composite PK (userId, slot). The frontend builds a
    // base64url-encoded JSON tuple as the URL :id; the backend decodes it
    // and runs `WHERE userId = ? AND slot = ?`. Cover the full
    // GET/PATCH/DELETE round-trip so this stays wired.
    const loginRes = await fetch(`${BASE}/admin-api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie')!.split(';')[0];

    const usersRes = await fetch(`${BASE}/admin-api/users`, { headers: { cookie: cookieHeader } });
    const userId = (await usersRes.json() as Array<{ id: string }>)[0]!.id;

    // Create a save to operate on
    const create = await fetch(`${BASE}/admin-api/cloudSaves`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({ user_id: userId, slot: 1, data: '{"hp":100}', version: 1 }),
    });
    assert.equal(create.status, 201, await create.text());

    // base64url(JSON.stringify([userId, 1])) — same shape the frontend produces
    const compositeId = Buffer.from(JSON.stringify([userId, 1]))
      .toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // GET — response keys are SQL column names so the frontend's
    // `record[c.name]` reads land. Without this, fields like board_id,
    // user_id, created_at on the Show page rendered as "—" because
    // drizzle's default `.select()` returns rows keyed by JS field names.
    const get = await fetch(`${BASE}/admin-api/cloudSaves/${compositeId}`, {
      headers: { cookie: cookieHeader },
    });
    assert.equal(get.status, 200);
    const row = await get.json() as Record<string, any>;
    assert.equal(row.user_id, userId);
    assert.equal(row.slot, 1);
    assert.ok(row.created_at, 'created_at should be present (SQL key)');
    assert.equal(row.userId, undefined, 'JS-name keys should not leak through');

    // PATCH version — response also SQL-keyed
    const patch = await fetch(`${BASE}/admin-api/cloudSaves/${compositeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({ version: 99 }),
    });
    assert.equal(patch.status, 200);
    const updated = await patch.json() as Record<string, any>;
    assert.equal(updated.version, 99);
    assert.equal(updated.user_id, userId);

    // DELETE
    const del = await fetch(`${BASE}/admin-api/cloudSaves/${compositeId}`, {
      method: 'DELETE',
      headers: { cookie: cookieHeader },
    });
    assert.equal(del.status, 200);
  });

  it('row update accepts both PATCH and PUT', async () => {
    // Refine's simple-rest data provider sends PATCH for the `update` op;
    // some custom clients use PUT. The endpoint accepts both and runs the
    // same handler. Regression test pins this so the frontend's PATCH
    // doesn't 404 again.
    const loginRes = await fetch(`${BASE}/admin-api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie')!.split(';')[0];

    const usersRes = await fetch(`${BASE}/admin-api/users`, { headers: { cookie: cookieHeader } });
    const userId = (await usersRes.json() as Array<{ id: string }>)[0]!.id;

    for (const method of ['PATCH', 'PUT'] as const) {
      const res = await fetch(`${BASE}/admin-api/users/${userId}`, {
        method,
        headers: { 'content-type': 'application/json', cookie: cookieHeader },
        body: JSON.stringify({ display_name: `Endel via ${method}` }),
      });
      assert.equal(res.status, 200, `expected 200 for ${method}`);
      // Response is SQL-keyed (display_name), matching what the form binds to.
      const row = await res.json() as Record<string, any>;
      assert.equal(row.display_name, `Endel via ${method}`);
    }
  });

  it('admin Create / Update / Delete writes audit log entries', async () => {
    const loginRes = await fetch(`${BASE}/admin-api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie')!.split(';')[0];

    // Mutations of all three kinds
    await fetch(`${BASE}/admin-api/configs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({ key: 'audit_test', value: 'one' }),
    });
    await fetch(`${BASE}/admin-api/configs/audit_test`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({ value: 'two' }),
    });
    await fetch(`${BASE}/admin-api/configs/audit_test`, {
      method: 'DELETE',
      headers: { cookie: cookieHeader },
    });

    // Read the audit table directly via the admin's CRUD endpoint —
    // it's a plain resource because adminAudit is registered as a table.
    const log = await fetch(`${BASE}/admin-api/adminAudit?_sort=created_at&_order=DESC&_start=0&_end=10`, {
      headers: { cookie: cookieHeader },
    });
    assert.equal(log.status, 200);
    const entries = await log.json() as Array<{
      action: string; resource: string; target_id: string | null; operator_id: string | null;
    }>;
    const ours = entries.filter((e) => e.resource === 'configs' && e.target_id === 'audit_test');
    assert.ok(ours.length >= 3, `expected 3 audit entries for configs/audit_test, got ${ours.length}`);
    const actions = new Set(ours.map((e) => e.action));
    assert.ok(actions.has('create'));
    assert.ok(actions.has('update'));
    assert.ok(actions.has('delete'));
    // Operator id was the bootstrap admin
    assert.ok(ours.every((e) => e.operator_id != null));
  });

  it('CRUD with FK columns: POST translates SQL→JS column names so FKs land', async () => {
    // Regression test for the form-to-drizzle key translation. The frontend
    // posts bodies keyed by SQL column names (`board_id`, `user_id`); drizzle
    // expects JS field names (`boardId`, `userId`) and silently drops
    // unknown keys, which previously caused NOT NULL constraint failures
    // on FK fields the user actually filled in.
    const loginRes = await fetch(`${BASE}/admin-api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie')!.split(';')[0];

    // Seed a leaderboard + a user to point the entry at.
    await fetch(`${BASE}/admin-api/leaderboards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({ id: 'main', name: 'Main' }),
    });
    const usersRes = await fetch(`${BASE}/admin-api/users`, { headers: { cookie: cookieHeader } });
    const userId = (await usersRes.json() as Array<{ id: string }>)[0]!.id;

    const create = await fetch(`${BASE}/admin-api/leaderboardEntries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({ board_id: 'main', user_id: userId, score: 100 }),
    });
    const body = await create.text();
    assert.equal(create.status, 201, `expected 201, got ${create.status}: ${body}`);
    // Response is SQL-keyed: board_id / user_id, not boardId / userId.
    const row = JSON.parse(body) as Record<string, any>;
    assert.equal(row.board_id, 'main');
    assert.equal(row.user_id, userId);
    assert.equal(row.score, 100);
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

  it('catalog includes FK relations per resource', async () => {
    const res = await fetch(`${BASE}/admin-api`);
    const catalog = await res.json() as Array<{
      name: string;
      relations: Array<{ name: string; target: string; kind: 'one' | 'many' }>;
    }>;
    const usersResource = catalog.find((r) => r.name === 'users')!;
    const relNames = usersResource.relations.map((r) => r.name).sort();
    // Built-ins users → cloudSaves / playerItems / leaderboardEntries / etc.
    for (const expected of ['cloudSaves', 'playerItems', 'leaderboardEntries', 'role']) {
      assert.ok(relNames.includes(expected),
        `users relations should include ${expected}, got: ${relNames.join(', ')}`);
    }
    const role = usersResource.relations.find((r) => r.name === 'role')!;
    assert.equal(role.kind, 'one');
    assert.equal(role.target, 'userRoles');
  });

  it('counts endpoint returns every many-relation in one request', async () => {
    // Replaces N parallel `_start=0&_end=1` per-tab calls with a single
    // bulk fetch — the source of truth for the count badges on detail
    // page tabs. Should include only kind:'many' relations whose target
    // is registered as an admin resource.
    const loginRes = await fetch(`${BASE}/admin-api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie')!.split(';')[0];

    const usersRes = await fetch(`${BASE}/admin-api/users`, { headers: { cookie: cookieHeader } });
    const userId = (await usersRes.json() as Array<{ id: string }>)[0]!.id;

    const res = await fetch(`${BASE}/admin-api/users/${userId}/_counts`, {
      headers: { cookie: cookieHeader },
    });
    assert.equal(res.status, 200);
    const counts = await res.json() as Record<string, number>;

    // Every many-relation declared on `users` shows up in the map.
    for (const expected of ['cloudSaves', 'playerItems', 'leaderboardEntries', 'analyticsEvents', 'modAssignments']) {
      assert.ok(expected in counts, `expected '${expected}' in counts, got: ${Object.keys(counts).join(', ')}`);
      assert.equal(typeof counts[expected], 'number');
    }
    // `role` is a one-relation — should NOT appear in the counts map.
    assert.ok(!('role' in counts), 'one-relations should be excluded');
  });

  it('relation endpoint returns related rows for a given parent id', async () => {
    // Login as admin
    const loginRes = await fetch(`${BASE}/admin-api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie')!.split(';')[0];

    // Find the bootstrap admin's user id from the users list
    const usersRes = await fetch(`${BASE}/admin-api/users`, { headers: { cookie: cookieHeader } });
    const users = await usersRes.json() as Array<{ id: string }>;
    assert.ok(users.length > 0, 'expected at least one user');
    const userId = users[0]!.id;

    // The bootstrap flow assigned the admin role — users → role (one) should
    // now resolve to that single row.
    const roleRes = await fetch(
      `${BASE}/admin-api/users/${userId}/relations/role`,
      { headers: { cookie: cookieHeader } },
    );
    assert.equal(roleRes.status, 200);
    const roleRows = await roleRes.json() as Array<{ userId: string; role: string }>;
    assert.equal(roleRows.length, 1, 'admin should have exactly one role row');
    assert.equal(roleRows[0]!.role, 'admin');

    // users → cloudSaves (many) should be empty for a fresh admin
    const savesRes = await fetch(
      `${BASE}/admin-api/users/${userId}/relations/cloudSaves`,
      { headers: { cookie: cookieHeader } },
    );
    assert.equal(savesRes.status, 200);
    const saves = await savesRes.json();
    assert.deepEqual(saves, []);
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

  it('dashboard endpoint respects builtIns allowlist + widget overrides', async () => {
    // app.config.ts: builtIns = ['recentUsers']; widgets override `health`
    // and append `rooms`. So expected ids are: recentUsers, health, rooms.
    // `totals` and `activeEvents` are explicitly opted-out.
    const loginRes = await fetch(`${BASE}/admin-api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie')!.split(';')[0];

    const res = await fetch(`${BASE}/admin-api/_dashboard`, {
      headers: { cookie: cookieHeader },
    });
    assert.equal(res.status, 200);
    const payload = await res.json() as {
      widgets: Array<{ id: string; render: string; data: any; error?: string }>;
    };
    const ids = payload.widgets.map((w) => w.id);
    assert.deepEqual(ids.sort(), ['health', 'recentUsers', 'rooms', 'segments'].sort(),
      `expected only allow-listed + custom widgets, got: ${ids.join(', ')}`);

    // `segments` widget reflects every registered segment as a KPI key
    const segments = payload.widgets.find((w) => w.id === 'segments')!;
    assert.equal(segments.error, undefined);
    const segData = segments.data as Record<string, number>;
    for (const expected of ['newPlayers', 'veterans', 'climbing']) {
      assert.ok(expected in segData, `segments KPI should include '${expected}', got: ${Object.keys(segData).join(', ')}`);
    }

    // overridden built-in (health) carries the user's data shape
    const health = payload.widgets.find((w) => w.id === 'health')!;
    assert.equal(health.error, undefined);
    assert.ok('uptime' in (health.data as any), `health override should expose uptime, got: ${JSON.stringify(health.data)}`);
    // appended custom widget
    const rooms = payload.widgets.find((w) => w.id === 'rooms')!;
    assert.equal(rooms.error, undefined);
  });

  it('dashboard renders only the configured widget cards in the UI', async () => {
    const page = await browser!.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-email"]');
    await page.type('input[data-testid="login-email"]', BOOTSTRAP_EMAIL);
    await page.type('input[data-testid="login-password"]', BOOTSTRAP_PASSWORD);
    await page.click('[data-testid="login-submit"]');

    // builtIns allowlist kept recentUsers + segments; widgets override health + add rooms
    await page.waitForSelector('[data-testid="widget-recentUsers"]', { timeout: 15_000 });
    await page.waitForSelector('[data-testid="widget-segments"]', { timeout: 5_000 });
    await page.waitForSelector('[data-testid="widget-health"]', { timeout: 5_000 });
    await page.waitForSelector('[data-testid="widget-rooms"]', { timeout: 5_000 });

    // opted-out built-ins must NOT appear
    const totalsCard = await page.$('[data-testid="widget-totals"]');
    assert.equal(totalsCard, null, 'totals widget should be opted out via builtIns allowlist');
    const eventsCard = await page.$('[data-testid="widget-activeEvents"]');
    assert.equal(eventsCard, null, 'activeEvents widget should be opted out via builtIns allowlist');
    await page.close();
  });

  it('list endpoint supports ?_q=… search across text columns', async () => {
    // The bootstrap admin's email is admin@example.com — searching by part
    // of the email should return them, and searching for nonsense should
    // return an empty list with x-total-count: 0.
    const loginRes = await fetch(`${BASE}/admin-api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie')!.split(';')[0];

    const hit = await fetch(`${BASE}/admin-api/users?_q=admin%40`, { headers: { cookie: cookieHeader } });
    assert.equal(hit.status, 200);
    const hits = await hit.json() as Array<{ email: string }>;
    assert.ok(hits.length >= 1, 'should find the bootstrap admin by email substring');
    assert.ok(hits[0]!.email.includes('admin@'), 'returned row should match the search');
    assert.equal(hit.headers.get('x-total-count'), String(hits.length));

    const miss = await fetch(`${BASE}/admin-api/users?_q=zzznotpresent`, { headers: { cookie: cookieHeader } });
    const missRows = await miss.json() as any[];
    assert.equal(missRows.length, 0);
    assert.equal(miss.headers.get('x-total-count'), '0');
  });

  it('list page search input filters the rendered table', async () => {
    const page = await browser!.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-email"]');
    await page.type('input[data-testid="login-email"]', BOOTSTRAP_EMAIL);
    await page.type('input[data-testid="login-password"]', BOOTSTRAP_PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('[data-testid="widget-recentUsers"]', { timeout: 15_000 });

    await page.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="list-users"] tbody tr[data-row-id]', { timeout: 10_000 });
    const initialRowCount = (await page.$$eval('[data-testid="list-users"] tbody tr[data-row-id]',
      (rows) => rows.length));
    assert.ok(initialRowCount >= 1);

    // Search for nonsense → table should empty out
    await page.type('[data-testid="search-users"] input', 'zzznotpresent');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="list-users"] tbody tr[data-row-id]').length === 0,
      { timeout: 5_000 },
    );
    await page.close();
  });

  it('list endpoint supports per-column filters (email_like, level_gte)', async () => {
    const loginRes = await fetch(`${BASE}/admin-api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie')!.split(';')[0];

    // email_like should match the bootstrap admin
    const byEmail = await fetch(`${BASE}/admin-api/users?email_like=admin%40`, {
      headers: { cookie: cookieHeader },
    });
    assert.equal(byEmail.status, 200);
    const byEmailRows = await byEmail.json() as Array<{ email: string }>;
    assert.ok(byEmailRows.length >= 1);
    assert.ok(byEmailRows[0]!.email.includes('admin@'));

    // level_gte=99 should match no users (default level is 1)
    const byLevel = await fetch(`${BASE}/admin-api/users?level_gte=99`, {
      headers: { cookie: cookieHeader },
    });
    const byLevelRows = await byLevel.json() as any[];
    assert.equal(byLevelRows.length, 0);
    assert.equal(byLevel.headers.get('x-total-count'), '0');
  });

  it('Edit page mirrors the Show layout with relation tabs', async () => {
    const loginRes = await fetch(`${BASE}/admin-api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie')!.split(';')[0];
    const usersRes = await fetch(`${BASE}/admin-api/users`, { headers: { cookie: cookieHeader } });
    const userId = (await usersRes.json() as Array<{ id: string }>)[0]!.id;

    const page = await browser!.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-email"]');
    await page.type('input[data-testid="login-email"]', BOOTSTRAP_EMAIL);
    await page.type('input[data-testid="login-password"]', BOOTSTRAP_PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('[data-testid="widget-recentUsers"]', { timeout: 15_000 });

    await page.goto(`${BASE}/admin/users/edit/${userId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="edit-tabs-users"]', { timeout: 10_000 });
    await page.waitForSelector('[data-testid="edit-users"]', { timeout: 5_000 });
    await page.waitForSelector('[data-testid="tab-relation-cloudSaves"]', { timeout: 5_000 });
    await page.close();
  });

  it('JSON columns render the CodeMirror json editor, not a textarea', async () => {
    // cloudSaves.data is a `text` column with JSON mode; the form should
    // route it to the syntax-highlighted JsonEditor (CodeMirror under
    // the hood), not the plain textarea we used to render.
    const page = await browser!.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-email"]');
    await page.type('input[data-testid="login-email"]', BOOTSTRAP_EMAIL);
    await page.type('input[data-testid="login-password"]', BOOTSTRAP_PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('[data-testid="widget-recentUsers"]', { timeout: 15_000 });

    await page.goto(`${BASE}/admin/cloudSaves/create`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="create-cloudSaves"]', { timeout: 10_000 });

    // The JsonEditor wrapper uses data-testid="json-<colname>" and renders
    // CodeMirror inside (look for .cm-editor as a stable hook).
    await page.waitForSelector('[data-testid="json-data"] .cm-editor', { timeout: 5_000 });
    await page.close();
  });

  it('FK columns render a searchable RelationPicker, not a text input', async () => {
    const loginRes = await fetch(`${BASE}/admin-api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie')!.split(';')[0];
    const usersRes = await fetch(`${BASE}/admin-api/users`, { headers: { cookie: cookieHeader } });
    const userId = (await usersRes.json() as Array<{ id: string }>)[0]!.id;

    const page = await browser!.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-email"]');
    await page.type('input[data-testid="login-email"]', BOOTSTRAP_EMAIL);
    await page.type('input[data-testid="login-password"]', BOOTSTRAP_PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('[data-testid="widget-recentUsers"]', { timeout: 15_000 });

    // cloudSaves has a one-relation `user` with fk `user_id`. The Create
    // page should render a RelationPicker for that column instead of a
    // plain text input.
    await page.goto(
      `${BASE}/admin/cloudSaves/create?_prefill_user_id=${encodeURIComponent(userId)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForSelector('[data-testid="create-cloudSaves"]', { timeout: 10_000 });
    await page.waitForSelector('[data-testid="relation-picker-users"]', { timeout: 5_000 });

    // The picker should contain the prefilled user id (rendered inside an
    // AntD Select selection item — the inner span carries the label/value).
    await page.waitForFunction(
      (uid: string) => {
        const picker = document.querySelector('[data-testid="relation-picker-users"]');
        if (!picker) { return false; }
        const txt = (picker.textContent ?? '');
        return txt.includes(uid.slice(0, 6));
      },
      { timeout: 5_000 },
      userId,
    );
    await page.close();
  });

  it('"+ New related" button on a relation tab opens Create with FK pre-filled', async () => {
    const loginRes = await fetch(`${BASE}/admin-api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie')!.split(';')[0];
    const usersRes = await fetch(`${BASE}/admin-api/users`, { headers: { cookie: cookieHeader } });
    const userId = (await usersRes.json() as Array<{ id: string }>)[0]!.id;

    const page = await browser!.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-email"]');
    await page.type('input[data-testid="login-email"]', BOOTSTRAP_EMAIL);
    await page.type('input[data-testid="login-password"]', BOOTSTRAP_PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('[data-testid="widget-recentUsers"]', { timeout: 15_000 });

    await page.goto(`${BASE}/admin/users/show/${userId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="tab-relation-cloudSaves"]', { timeout: 10_000 });
    await page.click('[data-testid="tab-relation-cloudSaves"]');
    await page.waitForSelector('[data-testid="new-related-cloudSaves"]', { timeout: 5_000 });
    await page.click('[data-testid="new-related-cloudSaves"]');
    // landed on the cloudSaves Create page with prefill in the URL — fk is
    // sent as the SQL column name (`user_id`), matching the form field name.
    await page.waitForFunction(
      () => /\/cloudSaves\/create\?_prefill_user_id=/.test(window.location.href),
      { timeout: 5_000 },
    );
    await page.waitForSelector('[data-testid="create-cloudSaves"]', { timeout: 5_000 });

    // user_id is a FK column → renders as a RelationPicker, not a plain
    // input. The picker should show the prefilled parent id (or its label)
    // in its visible selection area.
    await page.waitForSelector('[data-testid="relation-picker-users"]', { timeout: 5_000 });
    await page.waitForFunction(
      (uid: string) => {
        const picker = document.querySelector('[data-testid="relation-picker-users"]');
        if (!picker) { return false; }
        return (picker.textContent ?? '').includes(uid.slice(0, 6));
      },
      { timeout: 5_000 },
      userId,
    );
    await page.close();
  });

  it('Show page renders relation tabs with counts and a one-relation link', async () => {
    // Login + navigate to a user's Show page; assert the cloudSaves and
    // playerItems tabs render, and the `role` one-relation appears as a
    // clickable Tag in the Profile descriptions.
    const loginRes = await fetch(`${BASE}/admin-api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie')!.split(';')[0];

    const usersRes = await fetch(`${BASE}/admin-api/users`, { headers: { cookie: cookieHeader } });
    const users = await usersRes.json() as Array<{ id: string }>;
    const userId = users[0]!.id;

    const page = await browser!.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-email"]');
    await page.type('input[data-testid="login-email"]', BOOTSTRAP_EMAIL);
    await page.type('input[data-testid="login-password"]', BOOTSTRAP_PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('[data-testid="widget-recentUsers"]', { timeout: 15_000 });

    await page.goto(`${BASE}/admin/users/show/${userId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`[data-testid="show-tabs-users"]`, { timeout: 10_000 });

    // Many-relation tabs present
    await page.waitForSelector('[data-testid="tab-relation-cloudSaves"]', { timeout: 5_000 });
    await page.waitForSelector('[data-testid="tab-relation-playerItems"]', { timeout: 5_000 });
    await page.waitForSelector('[data-testid="tab-relation-leaderboardEntries"]', { timeout: 5_000 });

    // One-relation: bootstrapped admin has role=admin, so the link should appear
    await page.waitForSelector('[data-testid="one-relation-role"]', { timeout: 10_000 });
    const roleText = await page.$eval('[data-testid="one-relation-role"]', (el) => el.textContent);
    assert.match(roleText ?? '', /role:/i);

    // Click cloudSaves tab → mini-table renders (empty for fresh admin)
    await page.click('[data-testid="tab-relation-cloudSaves"]');
    await page.waitForSelector('[data-testid="related-cloudSaves"]', { timeout: 5_000 });
    await page.close();
  });

  it('row actions include View, Edit, Delete', async () => {
    const page = await browser!.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-email"]');
    await page.type('input[data-testid="login-email"]', BOOTSTRAP_EMAIL);
    await page.type('input[data-testid="login-password"]', BOOTSTRAP_PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('[data-testid="widget-recentUsers"]', { timeout: 15_000 });

    await page.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="list-users"] tbody tr[data-row-id]', { timeout: 10_000 });

    // Three icon buttons in the actions column: view, edit, delete
    const actionLabels = await page.$$eval(
      '[data-testid="list-users"] tbody tr[data-row-id]:first-child td:last-child a, [data-testid="list-users"] tbody tr[data-row-id]:first-child td:last-child button',
      (els) => els.map((e) => (e.getAttribute('aria-label') ?? '')),
    );
    assert.ok(actionLabels.includes('view'), `expected view button, got: ${actionLabels.join(', ')}`);
    assert.ok(actionLabels.includes('edit'), `expected edit button, got: ${actionLabels.join(', ')}`);
    assert.ok(actionLabels.includes('delete'), `expected delete button, got: ${actionLabels.join(', ')}`);
    await page.close();
  });

  it('theme toggle is reachable from the header', async () => {
    const page = await browser!.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-email"]');
    await page.type('input[data-testid="login-email"]', BOOTSTRAP_EMAIL);
    await page.type('input[data-testid="login-password"]', BOOTSTRAP_PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('[data-testid="theme-toggle"]', { timeout: 15_000 });
    await page.close();
  });

  it('admin UI table renders custom column headers', async () => {
    const page = await browser!.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="login-email"]');
    await page.type('input[data-testid="login-email"]', BOOTSTRAP_EMAIL);
    await page.type('input[data-testid="login-password"]', BOOTSTRAP_PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.waitForSelector('[data-testid="widget-recentUsers"]', { timeout: 15_000 });
    await page.waitForSelector('nav a[href$="/users"]', { timeout: 5_000 });
    await page.evaluate(() => {
      (document.querySelector('nav a[href$="/users"]') as HTMLAnchorElement).click();
    });
    await page.waitForSelector('[data-testid="list-users"] thead', { timeout: 10_000 });

    const headers = await page.$$eval(
      '[data-testid="list-users"] thead th',
      (cells) => cells.map((c) => (c.textContent ?? '').trim()),
    );
    assert.ok(headers.includes('display_name'),
      `expected display_name header, got: ${headers.join(', ')}`);
    assert.ok(headers.includes('level'),
      `expected level header, got: ${headers.join(', ')}`);
    await page.close();
  });
});
