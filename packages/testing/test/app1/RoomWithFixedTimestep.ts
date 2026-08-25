import { Room, type StepContext } from "@colyseus/core";
import { Schema, type } from "@colyseus/schema";

export class FixedState extends Schema {
  @type("number") steps: number = 0;
}

/**
 * `setFixedTimestep` drives an accumulator, so one interval can run zero steps
 * or several - which is what makes sleeping for an interval an unreliable way
 * to wait for one.
 */
export class RoomWithFixedTimestep extends Room {
  state = new FixedState();

  onCreate(options: any) {
    this.setFixedTimestep((_ctx: StepContext) => { this.state.steps++; }, 30);
  }
}
