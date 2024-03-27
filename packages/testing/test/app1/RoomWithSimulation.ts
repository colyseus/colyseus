import { Room } from "@colyseus/core";
import { Schema, type } from "@colyseus/schema";

export class SimulationState extends Schema {
  @type("number") tick: number = 0;
}

export class RoomWithSimulation extends Room<SimulationState> {

  onCreate(options) {
    this.setState(new SimulationState());
    this.setSimulationInterval((dt) => this.tick(), 80);
  }

  tick() {
    this.state.tick++;
  }

}
