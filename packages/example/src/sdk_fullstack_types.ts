import { ColyseusSDK, getStateCallbacks } from "@colyseus/sdk";
import type { server } from "./app.config.ts";

const sdk = new ColyseusSDK<typeof server>("ws://localhost:2567");

async function connect() {
  const room = await sdk.joinOrCreate("my_room");

  room.send("move", { x: 100, y: 200 });
  room.send("movee", { x: 100, y: 200 });

  const $ = getStateCallbacks(room);
  $(room.state).players.onAdd((player, sessionId) => {
  });
}
