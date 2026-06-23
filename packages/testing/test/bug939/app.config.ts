import config from "@colyseus/tools";
import { defineRoom } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";

import { Bug939Room } from "./Bug939Room.ts";

export default config({
  rooms: {
    bug939: defineRoom(Bug939Room),
  },
  options: { greet: false },
  initializeTransport: (options) => new WebSocketTransport(options),
});
