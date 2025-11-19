import path from 'path';
import express, { Router } from 'express';
import { auth, JWT } from '@colyseus/auth';
import { matchMaker, IRoomCache } from '@colyseus/core';
import { applyMonkeyPatch } from './colyseus.ext.js';
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

  return router;
}
