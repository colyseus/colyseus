import { type Request } from 'express-jwt';

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
