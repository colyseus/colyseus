import { Request } from 'express-jwt';

import { JWT, JwtPayload, Jwt } from './JWT.ts';
import { auth, AuthSettings, RegisterWithEmailAndPasswordCallback, FindUserByEmailCallback, ParseTokenCallback, GenerateTokenCallback, HashPasswordCallback,} from './auth.ts';

import { OAuthProviderCallback } from './oauth.ts';
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
