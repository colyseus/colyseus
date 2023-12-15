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

console.warn(`
@colyseus/auth API's are in beta and may change in the future.
Please give feedback and report any issues you may find at https://github.com/colyseus/colyseus/issues/660
`);

export { Hash, JWT, auth, };
