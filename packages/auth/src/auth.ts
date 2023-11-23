import express from 'express';
import { generateId } from "@colyseus/core";
import { OAuthCallback, oAuthCallback, oauth } from "./oauth";
import { JWT } from './JWT';

export type RegisterCallback = (email: string, password: string) => Promise<unknown>;
export type LoginCallback = (email: string, password: string) => Promise<unknown>;
export type GenerateTokenCallback = (userdata: unknown) => Promise<unknown>;

export interface AuthSettings {
  onRegister: RegisterCallback,
  onLogin: LoginCallback,
  onGenerateToken: GenerateTokenCallback,

  onOAuthCallback: OAuthCallback,
};

let onLoginCallback: LoginCallback = (email: string, password: string) => { throw new Error("'onLogin' not set."); };
let onRegisterCallback: RegisterCallback = (email: string, password: string) => { throw new Error("'onRegister' not set."); };
let onGenerateToken: GenerateTokenCallback = async (userdata: unknown) => { return await JWT.sign(userdata); };

export const auth = {
  settings: {
    onRegister: onRegisterCallback,
    onLogin: onLoginCallback,
    onGenerateToken: onGenerateToken,
  },

  prefix: "/auth",
  middleware: JWT.middleware,

  routes: function (settings: Partial<AuthSettings> = {}) {
    const router = express.Router();

    // set register/login callbacks
    if (settings.onRegister) { auth.settings.onRegister = settings.onRegister; }
    if (settings.onLogin) { auth.settings.onLogin = settings.onLogin; }
    if (settings.onGenerateToken) { auth.settings.onGenerateToken = settings.onGenerateToken; }

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
      router.use(oauth.prefix, oauth.callback());
    }

    return router;
  },
};