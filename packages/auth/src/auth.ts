import express from 'express';
import { generateId } from "@colyseus/core";
import { OAuthCallback, oAuthCallback, oauth } from "./oauth";
import { JsonWebToken } from './JsonWebToken';

export type OnRegisterCallback = (email: string, password: string) => Promise<unknown>;
export type OnLoginCallback = (email: string, password: string) => Promise<unknown>;

export interface AuthSettings {
  onRegister: OnRegisterCallback,
  onLogin: OnLoginCallback,
  oAuthCallback: OAuthCallback,
};

let onLoginCallback: OnLoginCallback = (email: string, password: string) => {
  throw new Error("'onLogin' not set.");
  // return Promise.resolve({});
};

let onRegisterCallback: OnRegisterCallback = (email: string, password: string) => {
  throw new Error("'onRegister' not set.");
  // return Promise.resolve({});
};

export const auth = {
  prefix: "/auth",

  routes: function (settings: Partial<AuthSettings> = {}) {
    const router = express.Router();

    // set register/login callbacks
    if (settings.onRegister) { onRegisterCallback = settings.onRegister; }
    if (settings.onLogin) { onLoginCallback = settings.onLogin; }

    router.post("/login", async (req, res) => {
      try {
        const user = await onLoginCallback(req.body.email, req.body.password);
        const token = await JsonWebToken.sign(user);
        res.json({ user, token, });
      } catch (e) {
        res.status(401).json({ error: e.message });
      }
    });

    router.post("/register", async (req, res) => {
      const email = req.body.email;
      const password = req.body.password;

      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
        return res.status(400).json({ error: "Please provide a valid email address." });
      }

      if (password.length < 5) {
        return res.status(400).json({ error: "Password too short" });
      }

      try {
        const user = await onRegisterCallback(email, password);
        const token = await JsonWebToken.sign(user);
        res.json({ user, token, });

      } catch (e) {
        res.status(401).json({ error: e.message });
      }

    });

    router.post("/anonymous", async (req, res) => {
      const user = { id: generateId(21), anonymous: true };
      const token = await JsonWebToken.sign(user);
      res.json({ user, token, });
    });

    /**
     * oAuth (optional)
     */
    if (settings.oAuthCallback) {
      oauth.onCallback(settings.oAuthCallback);
    }

    if (oAuthCallback) {
      router.use(oauth.prefix, oauth.callback());
    }

    return router;
  },
};