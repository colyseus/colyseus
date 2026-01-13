import { Room, type Client } from "@colyseus/core";
import { Schema, type } from "@colyseus/schema";

export class SimulationState extends Schema {
  @type("number") tick: number = 0;
}

export class RoomWithSimulation extends Room {
  state = new SimulationState();

  messages = {
    hello_world: (client: Client, message) => {
      client.send("hello_world", "Hello, world!");
    }
  }

  onCreate(options) {
    this.setSimulationInterval((dt) => this.tick(), 80);
  }

  tick() {
    this.state.tick++;
  }

}
