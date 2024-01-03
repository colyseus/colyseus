import { Request } from 'express-jwt';

import { JWT, JwtPayload, Jwt } from './JWT';
import { auth, AuthSettings, RegisterWithEmailAndPasswordCallback, FindUserByEmailCallback, ParseTokenCallback, GenerateTokenCallback, HashPasswordCallback,} from './auth';

import { OAuthProviderCallback } from './oauth';
import { Hash } from './Hash';

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
