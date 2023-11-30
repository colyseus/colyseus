import { Request } from 'express-jwt';

import { JWT, JwtPayload, Jwt } from './JWT';
import { auth, AuthSettings, RegisterWithEmailAndPasswordCallback, FindUserByEmailCallback, ParseTokenCallback, GenerateTokenCallback, HashPasswordCallback,} from './auth';

import { OAuthProviderCallback } from './oauth';
import { Hash } from './Hash';

export type {
  Request, JwtPayload, Jwt,

  AuthSettings, RegisterWithEmailAndPasswordCallback as RegisterCallback, FindUserByEmailCallback as FindByEmailCallback, ParseTokenCallback, GenerateTokenCallback, HashPasswordCallback,

  OAuthProviderCallback as OAuthCallback,
};

export { Hash, JWT, auth, };
