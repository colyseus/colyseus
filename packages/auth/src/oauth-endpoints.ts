import fs from 'fs';
import path from 'path';
import { createEndpoint, createMiddleware, type Endpoint } from '@colyseus/core';
import GrantFactory from 'grant/lib/grant.js';
import { sign as cookieSign, unsign as cookieUnsign } from 'cookie-signature';
import { serialize as serializeCookie, parse as parseCookie } from 'cookie';

import { JWT } from './JWT.ts';
import { auth } from './auth.ts';
import {
  oauth,
  oAuthProviderCallback,
  type OAuthProviderName,
} from './oauth.ts';

const COOKIE_NAME = 'grant';

type GrantSessionPayload = { grant?: any; [k: string]: any };

function readSession(ctx: any, secret: string): GrantSessionPayload {
  const cookieHeader = ctx.getHeader('cookie') ?? '';
  const raw = parseCookie(cookieHeader)[COOKIE_NAME];
  if (!raw) { return {}; }
  const unsigned = cookieUnsign(raw, secret);
  if (unsigned === false) { return {}; }
  try {
    return JSON.parse(Buffer.from(unsigned as string, 'base64').toString());
  } catch {
    return {};
  }
}

function writeSession(ctx: any, secret: string, payload: GrantSessionPayload): void {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signed = cookieSign(data, secret);
  const proto = ctx.getHeader('x-forwarded-proto')
    ?? (ctx.request?.url?.startsWith('https://') ? 'https' : 'http');
  ctx.setHeader('set-cookie', serializeCookie(COOKIE_NAME, signed, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: proto === 'https',
  }));
}

function clearSession(ctx: any): void {
  ctx.setHeader('set-cookie', serializeCookie(COOKIE_NAME, '', {
    path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0,
  }));
}

function originFromContext(ctx: any): string {
  const proto = ctx.getHeader('x-forwarded-proto')
    ?? (ctx.request?.url?.startsWith('https://') ? 'https' : 'http');
  const host = ctx.getHeader('host') ?? 'localhost';
  return `${proto}://${host}`;
}

function readHelpUrls(): Record<string, string> {
  try {
    const p = path.join(import.meta.dirname, '..', 'oauth_help_urls.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { return {}; }
}

function missingProviderHelp(providerId: string): Response {
  if (process.env.NODE_ENV === 'production') {
    return new Response(`Missing OAuth provider configuration for "${providerId}".`);
  }
  const helpUrls = readHelpUrls();
  const providerUrl = helpUrls[providerId];
  return new Response(`<!doctype html>
<html>
<head>
<title>Missing "${providerId}" provider configuration</title>
<style>p { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"; }</style>
</head>
<body>
<p>Missing config for "${providerId}" OAuth provider.</p>
<hr />
<p><small><strong>Config example:</strong></small></p>
<pre><code>import { auth } from "@colyseus/auth";<br />
auth.oauth.addProvider("${providerId}", {
  key: "xxx",
  secret: "xxx",
});
</code></pre>
${providerUrl ? `<hr/><p><small><em>(Get your keys from <a href="${providerUrl}" target="_blank">${providerUrl}</a>)</em></small></p>` : ''}
</body>
</html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function postMessageHtml(payload: unknown): Response {
  return new Response(
    `<!DOCTYPE html><html><head><script type="text/javascript">window.opener.postMessage(${JSON.stringify(payload)}, '*');</script></head><body></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

export interface OAuthEndpointsOptions {
  prefix?: string;
  cookieSecret?: string;
}

export function oauthEndpoints(opts: OAuthEndpointsOptions = {}): Record<string, Endpoint> {
  const prefix = (opts.prefix ?? auth.prefix) + '/provider';

  function resolveSecret(): string {
    const secret = opts.cookieSecret
      ?? process.env.SESSION_SECRET
      ?? (typeof JWT.settings.secret === 'string' ? JWT.settings.secret : '')
      ?? process.env.JWT_SECRET
      ?? '';
    if (!secret) {
      throw new Error('[oauthEndpoints] OAuth requires a secret — set SESSION_SECRET (preferred) or JWT_SECRET, or pass cookieSecret');
    }
    return secret;
  }

  function buildGrantInstance() {
    const config: any = Object.assign({ defaults: { ...oauth.defaults } }, oauth.providers);
    config.defaults.prefix = prefix;
    if (!config.defaults.origin) { config.defaults.origin = auth.backend_url; }
    return GrantFactory({ config });
  }

  const start = createEndpoint(`${prefix}/:providerId`, { method: 'GET' }, async (ctx) => {
    const providerId = ctx.params.providerId as OAuthProviderName;
    if (!oauth.providers[providerId]) { return missingProviderHelp(providerId); }

    if (!auth.backend_url) { auth.backend_url = originFromContext(ctx); }
    if (!oauth.defaults.origin) { oauth.defaults.origin = auth.backend_url; }

    const grant = buildGrantInstance();
    const cookieSecret = resolveSecret();
    const prev = readSession(ctx, cookieSecret);
    const { location, session: next } = await grant({
      method: 'GET',
      params: { provider: providerId },
      query: ctx.query ?? {},
      body: {},
      session: prev.grant ?? {},
    });
    writeSession(ctx, cookieSecret, { ...prev, grant: next });
    if (!location) {
      return new Response('OAuth start did not produce a redirect.', { status: 500 });
    }
    return new Response(null, { status: 302, headers: { location } });
  });

  const callback = createEndpoint(`${prefix}/:providerId/callback`, { method: 'GET' }, async (ctx) => {
    const providerId = ctx.params.providerId as OAuthProviderName;
    const cookieSecret = resolveSecret();
    const prev = readSession(ctx, cookieSecret);

    const grant = buildGrantInstance();
    const { location, session: next } = await grant({
      method: 'GET',
      params: { provider: providerId, override: 'callback' },
      query: ctx.query ?? {},
      body: {},
      session: prev.grant ?? {},
    });
    writeSession(ctx, cookieSecret, { ...prev, grant: next });

    if (location) {
      return new Response(null, { status: 302, headers: { location } });
    }

    const grantSession = next as { response?: any; dynamic?: any; provider?: string };
    let response: unknown;
    let user: any = null;
    let token: any = null;

    if (grantSession.response?.error) {
      response = { error: grantSession.response.error, user, token };
    } else {
      const data: any = { ...grantSession.response };

      if (grantSession.dynamic?.token) {
        try { data.upgradingToken = await JWT.verify(grantSession.dynamic.token); }
        catch { /* ignore — non-fatal */ }
      }

      if (data.profile) {
        data.profile = oauth.transformProfileData(data.profile);
      }

      const callback = auth.settings.onOAuthProviderCallback ?? oAuthProviderCallback;
      const callbackUser = await callback(
        data as any,
        (grantSession.provider as OAuthProviderName) ?? providerId,
      );

      if (!callbackUser || typeof callbackUser !== 'object') {
        response = {
          error: 'OAuth callback returned no user — check onOAuthProviderCallback wiring',
          user: null, token: null,
        };
      } else {
        const banned = auth.settings.onCheckBanned
          ? await auth.settings.onCheckBanned(callbackUser)
          : null;
        if (banned) {
          response = {
            error: 'banned',
            user: null, token: null,
            reason: banned.reason ?? null,
            until: banned.until instanceof Date
              ? banned.until.toISOString()
              : banned.until ?? null,
          };
        } else {
          user = callbackUser;
          token = await auth.settings.onGenerateToken(user);
          response = { user, token };
        }
      }
    }

    clearSession(ctx);
    return postMessageHtml(response);
  });

  return {
    'auth-oauth-start': start,
    'auth-oauth-callback': callback,
  };
}
