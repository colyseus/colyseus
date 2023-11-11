import express from 'express';
import { generateId } from "@colyseus/core";
import { OAuthCallback, oAuthCallback, oauth } from "./oauth";

export interface AuthSettings {
  oAuthCallback: OAuthCallback,
}

export const auth = {
  prefix: "/auth",
  routes: function (settings: Partial<AuthSettings>) {
    const router = express.Router();

    router.post("/login", (req, res) => {
      res.json({});
    });

    router.post("/register", (req, res) => {
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