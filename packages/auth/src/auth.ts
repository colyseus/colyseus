import express from 'express';
import { generateId } from "@colyseus/core";
import { OAuthCallback, oAuthCallback, oauth } from "./oauth";

export type OnRegisterCallback = (email: string, password: string) => Promise<any>;
export type OnLoginCallback = (email: string, password: string) => Promise<any>;

export interface AuthSettings {
  onRegister: OnRegisterCallback,
  onLogin: OnLoginCallback,
  oAuthCallback: OAuthCallback,
};

let onLoginCallback: OnLoginCallback = (email: string, password: string) => {
  return Promise.resolve({});
};

let onRegisterCallback: OnRegisterCallback = (email: string, password: string) => {
  return Promise.resolve({});
};

export const auth = {
  prefix: "/auth",

  routes: function (settings: Partial<AuthSettings> = {}) {
    const router = express.Router();

    router.post("/login", (req, res) => {
      res.json({  });
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

      const user = await onRegisterCallback(email, password);

      res.json({});
    });

    router.post("/anonymous", (req, res) => {
      generateId(21); // collision probability similar to UUID v4
      res.json({});
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