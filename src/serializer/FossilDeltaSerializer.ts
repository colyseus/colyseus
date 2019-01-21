import * as fossilDelta from 'fossil-delta';
import * as msgpack from 'notepack.io';

import { Serializer } from './Serializer';

import * as jsonPatch from 'fast-json-patch'; // this is only used for debugging patches
import { debugPatch } from '../Debug';

export class FossilDeltaSerializer<T> implements Serializer<T> {
  public id = "fossil-delta";

  // when a new user connects, it receives the 'previousState', which holds
  // the last binary snapshot other users already have, therefore the patches
  // that follow will be the same for all clients.
  private previousState: any;
  private previousStateEncoded: any;

  private patches: any;

  public reset(newState: any) {
    this.previousState = newState;
    this.previousStateEncoded = msgpack.encode(this.previousState);
  }

  public getData() {
    return this.previousStateEncoded;
  }

  public hasChanged(newState: any) {
    const currentState = newState;
    const currentStateEncoded = msgpack.encode(currentState);
    const changed = !currentStateEncoded.equals(this.previousStateEncoded);

    if (changed) {
      this.patches = fossilDelta.create(this.previousStateEncoded, currentStateEncoded);

      //
      // debugging
      //
      if (debugPatch.enabled) {
        debugPatch(
          '%d bytes, %j',
          this.patches.length,
          jsonPatch.compare(msgpack.decode(this.previousStateEncoded), currentState),
        );
      }

      this.previousState = currentState;
      this.previousStateEncoded = currentStateEncoded;
    }

    return changed;
  }

  public getPatches() {
    return this.patches;
  }
}
