import { Serializer } from './Serializer';
import { Sync } from "@colyseus/schema";

export class SchemaSerializer<T> implements Serializer<T> {
  public id = "@colyseus/schema";
  private state: T & Sync;

  public reset(newState: any) {
    this.state = newState;
  }

  public getData() {
    return this.state;
  }

  public hasChanged(newState: any) {
    return newState['$changed'];
  }

  public getPatches() {
    return this.state.encode();
  }
}
