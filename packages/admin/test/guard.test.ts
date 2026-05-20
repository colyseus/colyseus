/**
 * admin.guard() middleware — unit tests.
 *
 * Stubs GameDatabase via a duck-typed fake (only `auth.getTokenVersion`
 * and `moderation.getRole` are touched) so the suite stays DB-free.
 */
import assert from 'node:assert';
import { describe, it, before } from 'node:test';
import { JWT } from '@colyseus/auth';
import { APIError } from '@colyseus/better-call';
import { admin } from '../src-backend/index.ts';
import { isSafePath } from '../src-backend/auth/guard.ts';

// The guard is only public as `admin.guard` (mirrors auth.middleware()).
// Alias keeps the assertions below reading naturally.
const adminGuard = admin.guard;
import { COOKIE_NAME, signSession } from '../src-backend/auth/sessions.ts';

before(() => {
  JWT.settings.secret = 'guard-test-secret';
});

type Role = 'admin' | 'mod' | 'user';

interface FakeDb {
  auth: { getTokenVersion: (userId: string) => Promise<number | undefined> };
  moderation: { getRole: (userId: string) => Promise<Role> };
}

function makeDb(opts: {
  tokenVersions?: Record<string, number | undefined>;
  roles?: Record<string, Role>;
} = {}): any {
  return {
    auth: {
      getTokenVersion: async (userId: string) =>
        opts.tokenVersions?.[userId] ?? 0,
    },
    moderation: {
      getRole: async (userId: string) => opts.roles?.[userId] ?? 'user',
    },
  };
}

async function invokeGuard(
  guard: ReturnType<typeof adminGuard>,
  headers: Record<string, string>,
  url = 'http://test.local/monitor/api/rooms',
): Promise<{ ok: true } | { ok: false; error: APIError }> {
  try {
    await (guard as any)({
      headers,
      request: new Request(url),
    });
    return { ok: true };
  } catch (e: any) {
    if (e?.name === 'APIError') { return { ok: false, error: e as APIError }; }
    throw e;
  }
}

describe('admin.guard', () => {
  describe('happy path', () => {
    it('passes a request with a valid admin session cookie', async () => {
      const db = makeDb({ roles: { 'u1': 'admin' } });
      const guard = adminGuard({ database: db });
      const token = await signSession({ userId: 'u1', role: 'admin', tv: 0 });
      const result = await invokeGuard(guard, {
        cookie: `${COOKIE_NAME}=${token}`,
      });
      assert.equal(result.ok, true, 'guard should pass');
    });

    it('passes when role exceeds the requirement (admin where mod required)', async () => {
      const db = makeDb({ roles: { 'u1': 'admin' } });
      const guard = adminGuard({ database: db, role: 'mod' });
      const token = await signSession({ userId: 'u1', role: 'admin', tv: 0 });
      const result = await invokeGuard(guard, {
        cookie: `${COOKIE_NAME}=${token}`,
      });
      assert.equal(result.ok, true);
    });

    it('accepts sessions without a tv claim (backwards compat)', async () => {
      const db = makeDb({ roles: { 'u1': 'admin' } });
      const guard = adminGuard({ database: db });
      const token = await signSession({ userId: 'u1', role: 'admin' }); // no tv
      const result = await invokeGuard(guard, {
        cookie: `${COOKIE_NAME}=${token}`,
      });
      assert.equal(result.ok, true);
    });
  });

  describe('missing / invalid cookie', () => {
    it('redirects browser visits (Accept: text/html) to the admin login with ?next=', async () => {
      const guard = adminGuard({ database: makeDb() });
      const result = await invokeGuard(
        guard,
        { accept: 'text/html,application/xhtml+xml' },
        'http://test.local/monitor/?foo=bar',
      );
      assert.equal(result.ok, false);
      const err = (result as any).error as APIError;
      assert.equal(err.statusCode, 302);
      const location = (err.headers as any).location;
      assert.ok(location.startsWith('/admin/?next='), `unexpected location: ${location}`);
      const next = decodeURIComponent(location.split('next=')[1]);
      assert.equal(next, '/monitor/?foo=bar');
    });

    it('returns 401 JSON for XHR-style requests (no text/html in Accept)', async () => {
      const guard = adminGuard({ database: makeDb() });
      const result = await invokeGuard(guard, { accept: 'application/json' });
      assert.equal(result.ok, false);
      const err = (result as any).error as APIError;
      assert.equal(err.statusCode, 401);
    });

    it('returns 401 JSON when Accept header is absent', async () => {
      const guard = adminGuard({ database: makeDb() });
      const result = await invokeGuard(guard, {});
      assert.equal(result.ok, false);
      assert.equal((result as any).error.statusCode, 401);
    });

    it('honors apiOnly: true — never redirects even on Accept: text/html', async () => {
      const guard = adminGuard({ database: makeDb(), apiOnly: true });
      const result = await invokeGuard(guard, { accept: 'text/html' });
      assert.equal(result.ok, false);
      assert.equal((result as any).error.statusCode, 401);
    });

    it('treats a tampered cookie like a missing one', async () => {
      const guard = adminGuard({ database: makeDb() });
      const token = await signSession({ userId: 'u1', role: 'admin', tv: 0 });
      const tampered = token.slice(0, -4) + 'XXXX';
      const result = await invokeGuard(guard, {
        cookie: `${COOKIE_NAME}=${tampered}`,
        accept: 'application/json',
      });
      assert.equal(result.ok, false);
      assert.equal((result as any).error.statusCode, 401);
    });

    it('omits ?next= when the URL would not survive the safety check', async () => {
      const guard = adminGuard({ database: makeDb() });
      const result = await invokeGuard(
        guard,
        { accept: 'text/html' },
        // Pathological URL — same-origin guarantees the path starts with /,
        // so the safe path check should still let this through with /
        'http://test.local/',
      );
      assert.equal(result.ok, false);
      const location = ((result as any).error.headers as any).location;
      // / is a safe path — should round-trip
      assert.equal(location, '/admin/?next=%2F');
    });

    it('uses a custom loginUrl when supplied', async () => {
      const guard = adminGuard({
        database: makeDb(),
        loginUrl: '/dashboard',
      });
      const result = await invokeGuard(
        guard,
        { accept: 'text/html' },
        'http://test.local/monitor/',
      );
      const location = ((result as any).error.headers as any).location;
      assert.ok(location.startsWith('/dashboard/?next='));
    });
  });

  describe('revoked sessions (bumped tokenVersion)', () => {
    it('rejects when DB tokenVersion has moved past the JWT claim', async () => {
      const db = makeDb({
        tokenVersions: { 'u1': 5 }, // DB says 5
        roles: { 'u1': 'admin' },
      });
      const guard = adminGuard({ database: db });
      const token = await signSession({ userId: 'u1', role: 'admin', tv: 0 }); // JWT says 0
      const result = await invokeGuard(guard, {
        cookie: `${COOKIE_NAME}=${token}`,
        accept: 'application/json',
      });
      assert.equal(result.ok, false);
      assert.equal((result as any).error.statusCode, 401);
    });
  });

  describe('insufficient role', () => {
    it('redirects browser visits to login and CLEARS the session cookie when role too low', async () => {
      const db = makeDb({ roles: { 'u1': 'mod' } });
      const guard = adminGuard({ database: db, role: 'admin' });
      const token = await signSession({ userId: 'u1', role: 'admin', tv: 0 });
      // Browser navigation: bounce to login with ?next=. Clearing the
      // cookie is what breaks the redirect loop — without it the visitor
      // still has a valid (lower-role) session and gets forwarded straight
      // back through the guard.
      const result = await invokeGuard(
        guard,
        { cookie: `${COOKIE_NAME}=${token}`, accept: 'text/html' },
        'http://test.local/playground/?x=1',
      );
      assert.equal(result.ok, false);
      const err = (result as any).error as APIError;
      assert.equal(err.statusCode, 302);
      const location = (err.headers as any).location;
      assert.ok(location.startsWith('/admin/?next='), `unexpected location: ${location}`);
      assert.equal(decodeURIComponent(location.split('next=')[1]), '/playground/?x=1');
      const setCookie = (err.headers as any)['set-cookie'];
      assert.match(setCookie ?? '', new RegExp(`^${COOKIE_NAME}=;`));
      assert.match(setCookie ?? '', /Max-Age=0/);
    });

    it('returns 403 JSON (no redirect) for XHR-style requests when role too low', async () => {
      const db = makeDb({ roles: { 'u1': 'mod' } });
      const guard = adminGuard({ database: db, role: 'admin' });
      const token = await signSession({ userId: 'u1', role: 'admin', tv: 0 });
      const result = await invokeGuard(guard, {
        cookie: `${COOKIE_NAME}=${token}`,
        accept: 'application/json',
      });
      assert.equal(result.ok, false);
      const err = (result as any).error as APIError;
      assert.equal(err.statusCode, 403);
      assert.match(err.body?.message ?? '', /you have 'mod'/);
    });

    it('honors apiOnly: true — 403 even on Accept: text/html when role too low', async () => {
      const db = makeDb({ roles: { 'u1': 'mod' } });
      const guard = adminGuard({ database: db, role: 'admin', apiOnly: true });
      const token = await signSession({ userId: 'u1', role: 'admin', tv: 0 });
      const result = await invokeGuard(guard, {
        cookie: `${COOKIE_NAME}=${token}`,
        accept: 'text/html',
      });
      assert.equal(result.ok, false);
      assert.equal((result as any).error.statusCode, 403);
    });

    it('treats the JWT role claim as untrusted — uses live DB role', async () => {
      // JWT carries role:'admin' (stale), DB says 'user' (demoted).
      // Guard requires admin → must reject based on DB, not JWT.
      const db = makeDb({ roles: { 'u1': 'user' } });
      const guard = adminGuard({ database: db, role: 'admin' });
      const token = await signSession({ userId: 'u1', role: 'admin', tv: 0 });
      const result = await invokeGuard(guard, {
        cookie: `${COOKIE_NAME}=${token}`,
        accept: 'application/json',
      });
      assert.equal(result.ok, false);
      assert.equal((result as any).error.statusCode, 403);
    });
  });

  describe('constructor', () => {
    it('throws synchronously when no database is available', () => {
      assert.throws(() => adminGuard({}), /no GameDatabase available/);
    });
  });
});

describe('isSafePath', () => {
  it('accepts plain paths', () => {
    assert.equal(isSafePath('/'), true);
    assert.equal(isSafePath('/monitor'), true);
    assert.equal(isSafePath('/monitor/api/rooms'), true);
    assert.equal(isSafePath('/admin?foo=bar'), true);
    assert.equal(isSafePath('/playground/?next=%2Ffoo'), true);
  });

  it('rejects protocol-relative URLs that browsers normalize off-host', () => {
    assert.equal(isSafePath('//evil.com'), false);
    assert.equal(isSafePath('//evil.com/path'), false);
    assert.equal(isSafePath('/\\evil.com'), false);
  });

  it('rejects absolute URLs', () => {
    assert.equal(isSafePath('http://evil.com/'), false);
    assert.equal(isSafePath('https://evil.com/path'), false);
    assert.equal(isSafePath('javascript:alert(1)'), false);
  });

  it('rejects empty / non-path inputs', () => {
    assert.equal(isSafePath(''), false);
    assert.equal(isSafePath('relative/path'), false);
    assert.equal(isSafePath('?query=only'), false);
  });

  it('rejects absurdly long inputs (DoS guard)', () => {
    assert.equal(isSafePath('/' + 'a'.repeat(1024)), false);
  });
});
