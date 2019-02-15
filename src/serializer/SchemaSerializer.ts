import { Serializer } from './Serializer';
import { Schema } from "@colyseus/schema";

export class SchemaSerializer<T> implements Serializer<T> {
  public id = "@colyseus/schema";
  private state: T & Schema;

  public reset(newState: any) {
    this.state = newState;
  }

  public getData() {
    return this.state.encode();
  }

  public hasChanged(newState: any) {
    return newState['$changed'];
  }

  public getPatches() {
    return this.state.encode();
  }
}
