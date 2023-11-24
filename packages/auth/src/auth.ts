import express from 'express';
import { generateId } from "@colyseus/core";
import { Request } from 'express-jwt';
import { OAuthCallback, oAuthCallback, oauth } from "./oauth";
import { JWT, JwtPayload } from './JWT';

export type RegisterCallback = (email: string, password: string) => Promise<unknown>;
export type LoginCallback = (email: string, password: string) => Promise<unknown>;
export type UserDataCallback = (token: JwtPayload) => Promise<unknown> | unknown;
export type GenerateTokenCallback = (userdata: unknown) => Promise<unknown>;

export interface AuthSettings {
  onRegister: RegisterCallback,
  onLogin: LoginCallback,
  onUserData: UserDataCallback,
  onGenerateToken: GenerateTokenCallback,

  onOAuthCallback: OAuthCallback,
};

let onLogin: LoginCallback = (email: string, password: string) => { throw new Error("'onLogin' not set."); };
let onRegister: RegisterCallback = (email: string, password: string) => { throw new Error("'onRegister' not set."); };
let onUserData: UserDataCallback = (jwt: JwtPayload) => { return jwt; };
let onGenerateToken: GenerateTokenCallback = async (userdata: unknown) => { return await JWT.sign(userdata); };

export const auth = {
  settings: { onRegister, onLogin, onUserData, onGenerateToken, },

  prefix: "/auth",
  middleware: JWT.middleware,

  routes: function (settings: Partial<AuthSettings> = {}) {
    const router = express.Router();

    router.use(auth.middleware());

    // set register/login callbacks
    if (settings.onRegister) { auth.settings.onRegister = settings.onRegister; }
    if (settings.onLogin) { auth.settings.onLogin = settings.onLogin; }
    if (settings.onUserData) { auth.settings.onUserData = settings.onUserData; }
    if (settings.onGenerateToken) { auth.settings.onGenerateToken = settings.onGenerateToken; }

    router.get("/userdata", async (req: Request, res) => {
      try {
        res.json(await auth.settings.onUserData(req.auth));
      } catch (e) {
        res.status(401).json({ error: e.message });
      }
    });

    router.post("/login", express.json(), async (req, res) => {
      try {
        const user = await auth.settings.onLogin(req.body.email, req.body.password);
        const token = await auth.settings.onGenerateToken(user);
        res.json({ user, token, });
      } catch (e) {
        res.status(401).json({ error: e.message });
      }
    });

    router.post("/register", express.json(), async (req, res) => {
      const email = req.body.email;
      const password = req.body.password;

      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
        return res.status(400).json({ error: "Please provide a valid email address." });
      }

      if (password.length < 5) {
        return res.status(400).json({ error: "Password too short" });
      }

      try {
        const user = await auth.settings.onRegister(email, password);
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

    /**
     * oAuth (optional)
     */
    if (settings.onOAuthCallback) {
      oauth.onCallback(settings.onOAuthCallback);
    }

    if (oAuthCallback) {
      router.use(oauth.prefix, oauth.routes());
    }

    return router;
  },
};