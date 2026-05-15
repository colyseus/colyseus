import assert from 'assert';
import { createRouter } from '@colyseus/core';
import {
  JWT, auth, Hash,
  endpoints,
  loginEndpoint,
  registerEndpoint,
  anonymousEndpoint,
  forgotPasswordEndpoint,
  resetPasswordGetEndpoint,
  resetPasswordPostEndpoint,
  confirmEmailEndpoint,
  userdataEndpoint,
} from '../src/index.ts';

JWT.settings.secret = '@%^&';

const passwordPlainText = '123456';

// Helper for the few tests that need to exercise the HTTP wire (urlencoded
// bodies, full router dispatch). Direct endpoint calls bypass this.
function makeRequest(method: string, path: string, opts: { body?: any; headers?: Record<string, string> } = {}) {
  const url = `http://localhost${path}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(opts.headers ?? {}),
  };
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  return new Request(url, init);
}

// Catch APIError throws as { status, ...body } so each test can keep its
// existing status-code assertions while the endpoint itself stays typed.
async function tryEndpoint<R>(call: Promise<R>): Promise<R | { status: number; error?: string;[k: string]: any }> {
  try {
    return await call;
  } catch (e: any) {
    if (e?.statusCode && e?.body !== undefined) {
      return { status: e.statusCode, ...(typeof e.body === 'object' ? e.body : { error: String(e.body) }) };
    }
    throw e;
  }
}

describe('auth.endpoints()', () => {
  let fakedb: Record<string, string>;
  let onRegisterOptions: any;

  beforeEach(() => {
    fakedb = {};
    onRegisterOptions = undefined;

    // Mutate `auth.settings` directly — single source of truth.
    auth.settings.onFindUserByEmail = async (email) => {
      if (fakedb[email] !== undefined) {
        return { id: 100, email, password: fakedb[email] };
      }
      return null;
    };
    auth.settings.onRegisterWithEmailAndPassword = async (email, password, options) => {
      fakedb[email] = password;
      onRegisterOptions = options;
      return { id: 100, email };
    };
  });

  describe('POST /auth/anonymous', () => {
    it('returns an anonymous user + token', async () => {
      const data = await anonymousEndpoint()({ body: {} });
      // Type-level proof: `data.user.anonymousId` is reachable without `any` casts.
      assert.ok(data.user);
      assert.ok((data.user as any).anonymousId);
      assert.strictEqual((data.user as any).anonymous, true);
      assert.ok(data.token);
    });
  });

  describe('POST /auth/register + /auth/login', () => {
    const email = 'endel@colyseus.io';

    it('registers a new user', async () => {
      const data = await registerEndpoint()({
        body: { email, password: passwordPlainText },
      });
      assert.strictEqual((data.user as any).email, email);
      assert.ok(data.token);
      assert.ok(fakedb[email]);
      assert.ok(await Hash.verify(passwordPlainText, fakedb[email]));
    });

    it('rejects malformed email with 400', async () => {
      const res = await tryEndpoint(registerEndpoint()({
        body: { email: 'not-an-email', password: passwordPlainText },
      }));
      assert.strictEqual((res as any).status, 400);
    });

    it('rejects short password with 400', async () => {
      const res = await tryEndpoint(registerEndpoint()({
        body: { email, password: '12' },
      }));
      assert.strictEqual((res as any).status, 400);
    });

    it('rejects duplicate email with 401', async () => {
      await registerEndpoint()({ body: { email, password: passwordPlainText } });
      const res = await tryEndpoint(registerEndpoint()({
        body: { email, password: passwordPlainText },
      }));
      assert.strictEqual((res as any).status, 401);
      assert.strictEqual((res as any).error, 'email_already_in_use');
    });

    it('logs in with correct credentials', async () => {
      await registerEndpoint()({ body: { email, password: passwordPlainText } });
      const data = await loginEndpoint()({
        body: { email, password: passwordPlainText },
      });
      // Typed: `data.user` + `data.token` are inferred from the handler.
      assert.strictEqual((data.user as any).email, email);
      assert.ok(data.token);
      assert.strictEqual((data.user as any).password, undefined);
    });

    it('rejects bad password with 401', async () => {
      await registerEndpoint()({ body: { email, password: passwordPlainText } });
      const res = await tryEndpoint(loginEndpoint()({
        body: { email, password: 'wrong' },
      }));
      assert.strictEqual((res as any).status, 401);
    });

    it('rejects unknown email with 401', async () => {
      const res = await tryEndpoint(loginEndpoint()({
        body: { email: 'unknown@example.com', password: passwordPlainText },
      }));
      assert.strictEqual((res as any).status, 401);
    });

    it('returns 403 banned when onCheckBanned reports banned', async () => {
      const previousFind = auth.settings.onFindUserByEmail;
      const previousCheck = auth.settings.onCheckBanned;
      auth.settings.onFindUserByEmail = async (e) =>
        ({ id: 1, email: e, password: await Hash.make(passwordPlainText) } as any);
      auth.settings.onCheckBanned = async () => ({ reason: 'spam', until: null });

      const res = await tryEndpoint(loginEndpoint()({
        body: { email, password: passwordPlainText },
      }));
      assert.strictEqual((res as any).status, 403);
      assert.strictEqual((res as any).error, 'banned');
      assert.strictEqual((res as any).reason, 'spam');

      auth.settings.onFindUserByEmail = previousFind;
      auth.settings.onCheckBanned = previousCheck;
    });
  });

  describe('GET /auth/userdata', () => {
    it('returns user from JWT', async () => {
      const token = await JWT.sign({ id: 42, email: 'x@y.z' });
      const data = await userdataEndpoint()({
        headers: new Headers({ authorization: `Bearer ${token}` }),
      });
      // `data` is typed as `{ user: unknown }` — the unknown is from
      // onParseToken's return type (`unknown` in AuthSettings).
      assert.strictEqual((data.user as any).id, 42);
    });

    it('rejects requests without a token', async () => {
      const res = await tryEndpoint(userdataEndpoint()({ headers: new Headers() }));
      assert.strictEqual((res as any).status, 401);
    });
  });

  describe('HTML routes', () => {
    // resetPasswordGet returns a Response (HTML) — call as a function and
    // read it as a Response.
    it('GET /auth/reset-password renders the form with the supplied token', async () => {
      const res = await resetPasswordGetEndpoint()({ query: { token: 'abc123' } });
      assert.match(res.headers.get('content-type') || '', /text\/html/);
      const body = await res.text();
      assert.match(body, /abc123/);
      assert.match(body, /\/auth\/reset-password/);
    });

    it('POST /auth/reset-password redirects to error when token is invalid', async () => {
      const res = await resetPasswordPostEndpoint()({
        body: { token: 'invalid', password: 'newpass1' },
      });
      assert.strictEqual(res.status, 302);
      const location = res.headers.get('location') || '';
      assert.match(location, /\/auth\/reset-password\?token=invalid&error=/);
    });

    it('POST /auth/reset-password redirects to success when token is valid', async () => {
      let resetCalledWith: string | null = null;
      const previous = auth.settings.onResetPassword;
      auth.settings.onResetPassword = async (e) => { resetCalledWith = e; return true; };

      const token = await JWT.sign({ email: 'x@y.z' }, { expiresIn: '5m' });
      const res = await resetPasswordPostEndpoint()({
        body: { token, password: 'newpass1' },
      });
      assert.strictEqual(res.status, 302);
      const location = res.headers.get('location') || '';
      assert.match(location, /\/auth\/reset-password\?success=/);
      assert.strictEqual(resetCalledWith, 'x@y.z');

      auth.settings.onResetPassword = previous;
    });

    it('GET /auth/confirm-email returns 404 when onEmailConfirmed is not configured', async () => {
      const res = await confirmEmailEndpoint()({ query: { token: 'anything' } });
      assert.strictEqual(res.status, 404);
    });

    it('GET /auth/confirm-email confirms valid token and redirects to success', async () => {
      let confirmedEmail: string | null = null;
      const previous = auth.settings.onEmailConfirmed;
      auth.settings.onEmailConfirmed = async (e) => { confirmedEmail = e; };

      const token = await JWT.sign({ email: 'confirm@me.com' }, { expiresIn: '5m' });
      const res = await confirmEmailEndpoint()({ query: { token } });
      assert.strictEqual(res.status, 302);
      const location = res.headers.get('location') || '';
      assert.match(location, /\/auth\/confirm-email\?success=/);
      assert.strictEqual(confirmedEmail, 'confirm@me.com');

      auth.settings.onEmailConfirmed = previous;
    });
  });

  describe('OAuth (exercised through the router — direct call would require cookie session plumbing)', () => {
    let router: ReturnType<typeof createRouter>;
    beforeEach(() => {
      router = createRouter(endpoints()) as ReturnType<typeof createRouter>;
    });

    it('renders the missing-config help page for an unconfigured provider', async () => {
      const res = await router.handler(makeRequest('GET', '/auth/provider/discord'));
      assert.strictEqual(res.status, 200);
      const body = await res.text();
      assert.match(body, /Missing.*discord/i);
    });

    it('issues a 302 to the provider when configured', async () => {
      auth.oauth.addProvider('discord', { key: 'test-key', secret: 'test-secret', scope: ['identify'] });
      const res = await router.handler(makeRequest('GET', '/auth/provider/discord'));
      assert.strictEqual(res.status, 302);
      assert.match(res.headers.get('location') || '', /^https?:\/\/discord\.com\/.+/i);
      assert.match(res.headers.get('set-cookie') || '', /^grant=/);
      delete (auth.oauth.providers as any).discord;
    });

    it('respects `oauth: false` — endpoint absent', async () => {
      const minimal = createRouter(endpoints({ oauth: false })) as ReturnType<typeof createRouter>;
      const res = await minimal.handler(makeRequest('GET', '/auth/provider/discord'));
      assert.strictEqual(res.status, 404);
    });
  });

  describe('settings overrides via auth.settings', () => {
    it('post-mount mutation of auth.settings wins on subsequent requests', async () => {
      const original = auth.settings.onRegisterAnonymously;
      let customCalled = false;
      auth.settings.onRegisterAnonymously = async () => {
        customCalled = true;
        return { id: 'custom', anonymous: true };
      };

      const data = await anonymousEndpoint()({ body: {} });
      assert.strictEqual(customCalled, true);
      assert.strictEqual((data.user as any).id, 'custom');

      auth.settings.onRegisterAnonymously = original;
    });
  });
});
