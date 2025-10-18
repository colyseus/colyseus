import { Request } from 'express-jwt';

import { JWT, JwtPayload, Jwt } from './JWT.js';
import { auth, AuthSettings, RegisterWithEmailAndPasswordCallback, FindUserByEmailCallback, ParseTokenCallback, GenerateTokenCallback, HashPasswordCallback, GameCenterAuthData, GameCenterAuthCallback } from './auth.js';

import { OAuthProviderCallback } from './oauth.js';
import { Hash } from './Hash.js';
import { authenticateGameCenter, GameCenterCredentials } from './GameCenter.js';

export type {
  Request, JwtPayload, Jwt,

  AuthSettings,
  RegisterWithEmailAndPasswordCallback,
  FindUserByEmailCallback,
  ParseTokenCallback,
  GenerateTokenCallback,
  HashPasswordCallback,

  OAuthProviderCallback,
  GameCenterAuthData,
  GameCenterAuthCallback,
  GameCenterCredentials,
};

export { Hash, JWT, auth, authenticateGameCenter };
