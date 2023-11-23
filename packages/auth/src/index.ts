import { Request } from 'express-jwt';

import { JsonWebToken, JwtPayload, Jwt } from "./JsonWebToken";
import { auth, RegisterCallback, GenerateTokenCallback, LoginCallback } from './auth';
import { OAuthCallback, oauth } from './oauth';

export type {
  Request,
  JwtPayload,
  Jwt,

  RegisterCallback as OnRegisterCallback,
  GenerateTokenCallback as OnGenerateToken,
  LoginCallback as OnLoginCallback,

  OAuthCallback,
};

export { JsonWebToken, auth, oauth, };
