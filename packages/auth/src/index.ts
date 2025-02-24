import { Request } from 'express-jwt';

import { JWT, JwtPayload, Jwt } from './JWT.js';
import { auth, AuthSettings, RegisterWithEmailAndPasswordCallback, FindUserByEmailCallback, ParseTokenCallback, GenerateTokenCallback, HashPasswordCallback,} from './auth.js';

import { OAuthProviderCallback } from './oauth.js';
import { Hash } from './Hash.js';

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
