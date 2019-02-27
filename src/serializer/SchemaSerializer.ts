import { Serializer } from './Serializer';
import { Schema, Reflection } from "@colyseus/schema";

export class SchemaSerializer<T> implements Serializer<T> {
  public id = "schema";
  private state: T & Schema;

  public reset(newState: any) {
    this.state = newState;
  }

  public getData() {
    return this.state.encodeAll()
  }

  public hasChanged(newState: any) {
    return newState['$changed'];
  }

  public getPatches() {
    return this.state.encode();
  }
  
  public handshake () {
    return Reflection.encode(this.state);
  }
}
