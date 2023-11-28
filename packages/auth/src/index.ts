import { Request } from 'express-jwt';

import { JWT, JwtPayload, Jwt } from './JWT';
import { auth, AuthSettings, RegisterCallback, FindByEmailCallback, ParseTokenCallback, GenerateTokenCallback, HashPasswordCallback,} from './auth';

import { OAuthCallback, oauth } from './oauth';
import { Hash } from './Hash';

export type {
  Request, JwtPayload, Jwt,

  AuthSettings, RegisterCallback, FindByEmailCallback, ParseTokenCallback, GenerateTokenCallback, HashPasswordCallback,

  OAuthCallback,
};

export { Hash, JWT, auth, oauth, };
