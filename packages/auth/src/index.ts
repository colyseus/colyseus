import { type Request } from 'express-jwt';
import { Room, logger } from '@colyseus/core';

import { JWT, type JwtPayload, type Jwt } from './JWT.ts';
import {
  auth,
  type AuthSettings,
  type RegisterWithEmailAndPasswordCallback,
  type FindUserByEmailCallback,
  type ParseTokenCallback,
  type GenerateTokenCallback,
  type HashPasswordCallback
} from './auth.ts';

import type { OAuthProviderCallback } from './oauth.ts';
import { Hash } from './Hash.ts';

export type {
  Request, JwtPayload, Jwt,

  AuthSettings,
  RegisterWithEmailAndPasswordCallback,
  FindUserByEmailCallback,
  ParseTokenCallback,
  GenerateTokenCallback,
  HashPasswordCallback,

  OAuthProviderCallback,
};

export { Hash, JWT, auth, };

// Email/page HTML template loader — exported so @colyseus/admin (and
// custom flows) can reuse the same resolver + consumer-override
// convention (`process.cwd()/html` shadows the bundled templates).
export { readTemplate, htmlTemplatePath } from './templates.ts';

// Endpoint factories — exported so consumers can call them directly with typed
// inputs/outputs (test-time contract assertions, custom router composition).
export {
  userdataEndpoint,
  loginEndpoint,
  registerEndpoint,
  anonymousEndpoint,
  forgotPasswordEndpoint,
  resetPasswordGetEndpoint,
  resetPasswordPostEndpoint,
  confirmEmailEndpoint,
  endpoints,
  type EndpointsOptions,
} from './endpoints.ts';

// ---------------------------------------------------------------------------
// Side-effect: install a JWT-decoding default for `Room.onAuth`.
//
// Every Colyseus room that hasn't overridden `static onAuth` now
// auto-decodes the auth token the SDK sends with `joinOrCreate(...)`.
// The verified payload becomes `client.auth` — so `client.auth.id` is
// the signed-in user's id without any per-room boilerplate.
//
// Behavior matrix:
//   - no token                  → returns `true` (matchmaker treats as
//                                  "no auth payload" — client.auth stays
//                                  undefined; anonymous flows keep working).
//   - valid token                → returns the decoded payload (object).
//   - malformed / expired token  → returns `false` → AUTH_FAILED.
//   - any token, no JWT secret   → returns `true`, same as no token. Auth
//                                  isn't set up, so the token can't be this
//                                  app's — typically one the browser kept
//                                  from another app on the same origin.
//                                  Rejecting it would lock that browser out
//                                  of an app that never asked for auth.
//
// We only patch when `Room.onAuth` is still the framework default — if
// the host process imported a custom replacement first, or a room
// subclass overrides `static onAuth`, that takes precedence.
// ---------------------------------------------------------------------------
let warnedTokenWithoutSecret = false;
const __frameworkDefaultOnAuth = Room.onAuth;
if ((Room as any).onAuth === __frameworkDefaultOnAuth) {
  (Room as any).onAuth = async function jwtDecodingOnAuth(token: string) {
    if (!token) { return true; }
    if (!JWT.settings.secret && !process.env.JWT_SECRET) {
      if (!warnedTokenWithoutSecret) {
        warnedTokenWithoutSecret = true;
        logger.warn("@colyseus/auth: ignoring the client's auth token, since no JWT secret is configured (set JWT_SECRET or JWT.settings.secret to verify tokens).");
      }
      return true;
    }
    try {
      const decoded = await JWT.verify<any>(token);
      // Optional server-side revocation gate. The JWT itself is
      // valid (good signature, not expired) but the issuer may
      // have revoked it (ban, "sign-out everywhere", forced
      // rotation). `@colyseus/database` registers a default
      // check that compares the token's `tokenVersion` claim
      // against the user's row; apps can plug in their own.
      const check = JWT.settings.revocationCheck;
      if (check) {
        const ok = await check(decoded);
        if (!ok) { return false; }
      }
      return decoded;
    } catch {
      return false;
    }
  };
}
