import { Schema, Context, type, MapSchema } from "@colyseus/schema";

export interface InputData {
  left: false;
  right: false;
  up: false;
  down: false;
  tick: number;
}

export class Player extends Schema {
  @type("number") x: number;
  @type("number") y: number;
  @type("number") tick: number;
  @type("number") something: number;

  inputQueue: InputData[] = [];

  method() {
    console.log("I'm a method....");
  }
}

export class MyRoomState extends Schema {
  @type("number") mapWidth: number;
  @type("number") mapHeight: number;

  @type({ map: Player }) players = new MapSchema<Player>();
}