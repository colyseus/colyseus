import express from 'express';
import { generateId, logger } from '@colyseus/core';
import { Request } from 'express-jwt';
import { OAuthProviderCallback, oAuthProviderCallback, oauth } from './oauth';
import { JWT, JwtPayload } from './JWT';
import { Hash } from './Hash';

export type RegisterWithEmailAndPasswordCallback<T = any> = (email: string, password: string, options: T) => Promise<unknown>;
export type RegisterAnonymouslyCallback<T = any> = (options: T) => Promise<unknown>;
export type FindUserByEmailCallback = (email: string) => Promise<unknown & { password: string }>;
export type ParseTokenCallback = (token: JwtPayload) => Promise<unknown> | unknown;
export type GenerateTokenCallback = (userdata: unknown) => Promise<unknown>;
export type HashPasswordCallback = (password: string) => Promise<string>;

export interface AuthSettings {
  onFindUserByEmail: FindUserByEmailCallback,
  onRegisterWithEmailAndPassword: RegisterWithEmailAndPasswordCallback,
  onRegisterAnonymously: RegisterAnonymouslyCallback,
  onOAuthProviderCallback?: OAuthProviderCallback,
  onParseToken?: ParseTokenCallback,
  onGenerateToken?: GenerateTokenCallback,
  onHashPassword?: HashPasswordCallback,
};

let onFindUserByEmail: FindUserByEmailCallback = (email: string) => { throw new Error('`auth.settings.onFindByEmail` not set.'); };
let onRegisterWithEmailAndPassword: RegisterWithEmailAndPasswordCallback = (email: string, password: string) => { throw new Error('`auth.settings.onRegister` not set.'); };
let onParseToken: ParseTokenCallback = (jwt: JwtPayload) => jwt;
let onGenerateToken: GenerateTokenCallback = async (userdata: unknown) => await JWT.sign(userdata);
let onHashPassword: HashPasswordCallback = async (password: string) => Hash.make(password);

export const auth = {
  /**
   * OAuth utilities
   */
  oauth: oauth,

  settings: {
    /**
     * Find user by email.
     */
    onFindUserByEmail,

    /**
     * Register user by email and password.
     */
    onRegisterWithEmailAndPassword,

    /**
     * (Optional) Register anonymous user.
     */
    onRegisterAnonymously: undefined as RegisterAnonymouslyCallback,

    /**
     * By default, it returns the contents of the JWT token. (onGenerateToken)
     */
    onParseToken,

    /**
     * By default, it encodes the full `userdata` object into the JWT token.
     */
    onGenerateToken,

    /**
     * Hash password before storing it. By default, it uses SHA1 + process.env.AUTH_SALT.
     */
    onHashPassword,
  } as AuthSettings,

  prefix: "/auth",
  middleware: JWT.middleware,

  routes: function (settings: Partial<AuthSettings> = {}) {
    const router = express.Router();

    // set register/login callbacks
    Object.keys(settings).forEach(key => {
      auth.settings[key] = settings[key];
    });

    if (!auth.settings.onParseToken) {
      auth.settings.onParseToken = onParseToken;
    }
    if (!auth.settings.onGenerateToken) {
      auth.settings.onGenerateToken = onGenerateToken;
    }
    if (!auth.settings.onHashPassword) {
      auth.settings.onHashPassword = onHashPassword;
    }

    /**
     * OAuth (optional)
     */
    if (settings.onOAuthProviderCallback) {
      oauth.onCallback(settings.onOAuthProviderCallback);
    }

    if (oAuthProviderCallback) {
      const prefix = oauth.prefix;

      // make sure oauth.prefix contains the full prefix
      oauth.prefix = auth.prefix + prefix;

      router.use(prefix, oauth.routes());
    }

    router.get("/userdata", auth.middleware(), async (req: Request, res) => {
      try {
        res.json({ user: await auth.settings.onParseToken(req.auth), });
      } catch (e) {
        res.status(401).json({ error: e.message });
      }
    });

    router.post("/login", express.json(), async (req, res) => {
      try {
        const email = req.body.email;
        if (!isValidEmail(email)) { throw new Error("email_malformed"); }

        const user = await auth.settings.onFindUserByEmail(email);
        if (user.password === Hash.make(req.body.password)) {
          res.json({ user, token: await auth.settings.onGenerateToken(user) });

        } else {
          throw new Error("invalid_credentials");
        }

      } catch (e) {
        logger.error(e);
        res.status(401).json({ error: e.message });
      }
    });

    router.post("/register", express.json(), async (req, res) => {
      const email = req.body.email;
      const password = req.body.password;

      if (!isValidEmail(email)) {
        return res.status(400).json({ error: "email_malformed" });
      }

      let existingUser: any;
      try {
        existingUser = await auth.settings.onFindUserByEmail(email)

      } catch (e) {
        logger.error('@colyseus/auth, onFindByEmail exception:' + e.stack);
      }

      try {
        // TODO: allow to set password on existing user, if valid token is equivalent to email
        //  (existingUser.password && existingUser.password.length > 0)
        if (existingUser) {
          throw new Error("email_already_in_use");
        }

        if (password.length < 5) {
          return res.status(400).json({ error: "password_too_short" });
        }

        // Register
        await auth.settings.onRegisterWithEmailAndPassword(email, Hash.make(password), req.body.options);

        const user = await auth.settings.onFindUserByEmail(email);
        const token = await auth.settings.onGenerateToken(user);
        res.json({ user, token, });

      } catch (e) {
        logger.error(e);
        res.status(401).json({ error: e.message });
      }
    });

    router.post("/anonymous", async (req, res) => {
      const options = req.body.options;

      // register anonymous user, if callback is defined.
      const user = (auth.settings.onRegisterAnonymously)
        ? await auth.settings.onRegisterAnonymously(options)
        : { ...options, id: undefined, anonymousId: generateId(21), anonymous: true }

      res.json({
        user,
        token: await onGenerateToken(user)
      });
    });

    return router;
  },
};

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)
}