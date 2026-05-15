import { type Request } from 'express-jwt';
import { Room } from '@colyseus/core';

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
//
// We only patch when `Room.onAuth` is still the framework default — if
// the host process imported a custom replacement first, or a room
// subclass overrides `static onAuth`, that takes precedence.
// ---------------------------------------------------------------------------
const __frameworkDefaultOnAuth = Room.onAuth;
if ((Room as any).onAuth === __frameworkDefaultOnAuth) {
  (Room as any).onAuth = async function jwtDecodingOnAuth(token: string) {
    if (!token) { return true; }
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
