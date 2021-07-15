import Arena from "@colyseus/arena";
import { WebSocketTransport } from "@colyseus/ws-transport";

import { RoomWithoutState } from "./RoomWithoutState";
import { RoomWithState } from "./RoomWithState";

export default Arena({
  getId: () => "My App 1",

  initializeTransport: (options) => new WebSocketTransport(options),

  initializeGameServer: (gameServer) => {
    gameServer.define("room_without_state", RoomWithoutState);
    gameServer.define("room_with_state", RoomWithState);
  }

})