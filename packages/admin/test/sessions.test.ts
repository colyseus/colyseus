import assert from 'node:assert';
import { describe, it, before } from 'node:test';
import { JWT } from '@colyseus/auth';
import {
  COOKIE_NAME,
  signSession,
  verifySession,
  setSessionCookie,
  clearSessionCookie,
  readSessionFromHeader,
} from '../src-backend/sessions.ts';

before(() => {
  JWT.settings.secret = 'test-secret-do-not-use-in-prod';
});

describe('sessions', () => {
  describe('signSession + verifySession', () => {
    it('round-trips userId + role', async () => {
      const token = await signSession({ userId: 'u1', role: 'admin' });
      const session = await verifySession(token);
      assert.ok(session, 'session should verify');
      assert.equal(session!.userId, 'u1');
      assert.equal(session!.role, 'admin');
    });

    it('attaches iat + exp claims', async () => {
      const token = await signSession({ userId: 'u1', role: 'mod' });
      const session = await verifySession(token);
      assert.ok(typeof session!.iat === 'number');
      assert.ok(typeof session!.exp === 'number');
      assert.ok(session!.exp! > session!.iat!);
    });

    it('honors custom ttlSeconds', async () => {
      const token = await signSession({ userId: 'u1', role: 'user' }, { ttlSeconds: 60 });
      const session = await verifySession(token);
      // 60s window — exp - iat should be exactly 60
      assert.equal(session!.exp! - session!.iat!, 60);
    });

    it('returns null for tampered tokens', async () => {
      const token = await signSession({ userId: 'u1', role: 'admin' });
      const tampered = token.slice(0, -4) + 'XXXX';
      const session = await verifySession(tampered);
      assert.equal(session, null);
    });

    it('returns null for garbage', async () => {
      assert.equal(await verifySession(''), null);
      assert.equal(await verifySession('not-a-jwt'), null);
      assert.equal(await verifySession('a.b.c'), null);
    });
  });

  describe('setSessionCookie', () => {
    it('builds a HttpOnly cookie with sane defaults', () => {
      const cookie = setSessionCookie('abc.def.ghi');
      assert.ok(cookie.startsWith(`${COOKIE_NAME}=abc.def.ghi`));
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Strict/);
      assert.match(cookie, /Path=\//);
      assert.match(cookie, /Max-Age=\d+/);
    });

    it('omits Secure outside production by default', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        const cookie = setSessionCookie('x');
        assert.doesNotMatch(cookie, /Secure/);
      } finally {
        process.env.NODE_ENV = original;
      }
    });

    it('emits Secure in production', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const cookie = setSessionCookie('x');
        assert.match(cookie, /Secure/);
      } finally {
        process.env.NODE_ENV = original;
      }
    });

    it('honors explicit cookieDomain + cookieSameSite + cookieSecure', () => {
      const cookie = setSessionCookie('x', {
        cookieDomain: 'example.com',
        cookieSameSite: 'Lax',
        cookieSecure: true,
      });
      assert.match(cookie, /Domain=example\.com/);
      assert.match(cookie, /SameSite=Lax/);
      assert.match(cookie, /Secure/);
    });
  });

  describe('clearSessionCookie', () => {
    it('emits Max-Age=0 to expire the cookie', () => {
      const cookie = clearSessionCookie();
      assert.match(cookie, /Max-Age=0/);
      assert.match(cookie, /HttpOnly/);
    });
  });

  describe('readSessionFromHeader', () => {
    it('parses a single cookie', async () => {
      const token = await signSession({ userId: 'u9', role: 'admin' });
      const session = await readSessionFromHeader(`${COOKIE_NAME}=${token}`);
      assert.equal(session?.userId, 'u9');
    });

    it('parses among multiple cookies', async () => {
      const token = await signSession({ userId: 'u10', role: 'mod' });
      const header = `other=foo; ${COOKIE_NAME}=${token}; another=bar`;
      const session = await readSessionFromHeader(header);
      assert.equal(session?.userId, 'u10');
    });

    it('returns null when the cookie is missing', async () => {
      assert.equal(await readSessionFromHeader('foo=bar'), null);
      assert.equal(await readSessionFromHeader(null), null);
      assert.equal(await readSessionFromHeader(undefined), null);
      assert.equal(await readSessionFromHeader(''), null);
    });

    it('returns null when the cookie value is bad', async () => {
      assert.equal(await readSessionFromHeader(`${COOKIE_NAME}=not-a-jwt`), null);
    });
  });
});
