import path from 'path';
import express, { Router } from 'express';
import { auth, JWT } from '@colyseus/auth';
import { matchMaker, IRoomCache, __globalEndpoints } from '@colyseus/core';
import type { Endpoint } from "@colyseus/better-call";
import { applyMonkeyPatch } from './colyseus.ext.js';
import { toJSONSchema } from './json-schema.js';

import { fileURLToPath } from 'url'; // required for ESM build (see build.mjs)

export type AuthConfig = {
  oauth: string[],
  register: boolean,
  anonymous: boolean,
};

export function playground(): Router {
  applyMonkeyPatch();

  const router = express.Router();

  // serve static frontend
  router.use("/", express.static(path.resolve(__dirname, "..", "build")));

  // expose matchmaking stats
  router.get("/rooms", async (req, res) => {
    const rooms = await matchMaker.driver.query({});

    const roomsByType: { [roomName: string]: number } = {};
    const roomsById: { [roomName: string]: IRoomCache } = {};

    rooms.forEach((room) => {
      if (!roomsByType[room.name]) { roomsByType[room.name] = 0; }
      roomsByType[room.name]++;
      roomsById[room.roomId] = room;
    });

    res.json({
      rooms: Object.keys(matchMaker.getAllHandlers()),

      roomsByType,
      roomsById,

      auth: {
        // list of OAuth providers
        oauth: Object.keys(auth.oauth.providers),
        register: typeof(auth.settings.onRegisterWithEmailAndPassword) === "function",
        anonymous: typeof(JWT.settings.secret) === "string",
      } as AuthConfig
    });
  });

  // serve API docs for playground
  // (workaround to use better-call route inside express.Router)
  router.get("/__apidocs", async (_, res) => {
    res.json(await Promise.all(Object.values(__globalEndpoints).map(async (endpoint: Endpoint) => {
      return {
        method: endpoint.options.method,
        path: endpoint.path,
        body: await toJSONSchema(endpoint.options.body),
        query: await toJSONSchema(endpoint.options.query),
        metadata: endpoint.options.metadata,
        description: endpoint.options.metadata?.openapi?.description,
      };
    })));
  });

  return router;
}
