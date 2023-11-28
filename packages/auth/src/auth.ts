import express from 'express';
import { generateId } from '@colyseus/core';
import { Request } from 'express-jwt';
import { OAuthCallback, oAuthCallback, oauth } from './oauth';
import { JWT, JwtPayload } from './JWT';
import { Hash } from './Hash';

export type RegisterCallback<T=any> = (email: string, password: string, options: T) => Promise<unknown>;
export type FindByEmailCallback = (email: string) => Promise<unknown & { password: string }>;
export type ParseTokenCallback = (token: JwtPayload) => Promise<unknown> | unknown;
export type GenerateTokenCallback = (userdata: unknown) => Promise<unknown>;
export type HashPasswordCallback = (password: string) => Promise<string>;

export interface AuthSettings {
  onRegister: RegisterCallback,
  onFindByEmail: FindByEmailCallback,
  onOAuthCallback?: OAuthCallback,
  onParseToken?: ParseTokenCallback,
  onGenerateToken?: GenerateTokenCallback,
  onHashPassword?: HashPasswordCallback,
};

let onRegister: RegisterCallback = (email: string, password: string) => { throw new Error('`auth.settings.onRegister` not set.'); };
let onFindByEmail: FindByEmailCallback = (email: string) => { throw new Error('`auth.settings.onFindByEmail` not set.'); };
let onParseToken: ParseTokenCallback = (jwt: JwtPayload) => { return jwt; };
let onGenerateToken: GenerateTokenCallback = async (userdata: unknown) => { return await JWT.sign(userdata); };
let onHashPassword: HashPasswordCallback = async (password: string) => { return Hash.make(password); };

export const auth = {
  settings: {
    /**
     * Register user by email and password.
     */
    onRegister,

    /**
     * Find user by email.
     */
    onFindByEmail,

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

    /**
     * OAuth (optional)
     */
    if (settings.onOAuthCallback) {
      oauth.onCallback(settings.onOAuthCallback);
    }

    if (oAuthCallback) {
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
        if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
          return res.status(400).json({ error: "Please provide a valid email address." });
        }

        const user = await auth.settings.onFindByEmail(email);
        if (user.password === Hash.make(req.body.password)) {
          res.json({ user, token: await auth.settings.onGenerateToken(user) });

        } else {
          throw new Error("invalid_credentials");
        }

      } catch (e) {
        res.status(401).json({ error: e.message });
      }
    });

    router.post("/register", express.json(), async (req, res) => {
      const email = req.body.email;
      const password = req.body.password;

      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
        return res.status(400).json({ error: "email_malformed" });
      }

      try {
        if (await auth.settings.onFindByEmail(email)) {
          throw new Error("email_already_in_use");
        }

        if (password.length < 5) {
          return res.status(400).json({ error: "password_too_short" });
        }

        const user = await auth.settings.onRegister(email, Hash.make(password), req.body.options);
        const token = await auth.settings.onGenerateToken(user);
        res.json({ user, token, });

      } catch (e) {
        res.status(401).json({ error: e.message });
      }
    });

    router.post("/anonymous", async (req, res) => {
      const user = { id: generateId(21), anonymous: true };
      const token = await onGenerateToken(user);
      res.json({ user, token, });
    });

    return router;
  },
};