import fossilDelta from 'fossil-delta';
import { pack, unpack } from 'msgpackr';

import { Client, Protocol, Serializer, debugPatch } from '@colyseus/core';
import jsonPatch from 'fast-json-patch'; // this is only used for debugging patches

export class FossilDeltaSerializer<T> implements Serializer<T> {
  public id = 'fossil-delta';

  // when a new user connects, it receives the 'previousState', which holds
  // the last binary snapshot other users already have, therefore the patches
  // that follow will be the same for all clients.
  private previousState: T;
  private previousStateEncoded: any;

  private patches: any;

  public reset(newState: T) {
    this.previousState = newState;
    this.previousStateEncoded = pack(this.previousState);
  }

  public getFullState(_?: Client) {
    return this.previousStateEncoded;
  }

  public applyPatches(clients: Client[], previousState: T) {
    const hasChanged = this.hasChanged(previousState);

    if (hasChanged) {
      this.patches.unshift(Protocol.ROOM_STATE_PATCH);

      let numClients = clients.length;

      while (numClients--) {
        const client = clients[numClients];
        client.enqueueRaw(this.patches);
      }
    }

    return hasChanged;
  }

  public hasChanged(newState: T) {
    const currentState = newState;
    let changed: boolean = false;
    let currentStateEncoded;

    /**
     * allow optimized state changes when using `Schema` class.
     */
    if (newState?.['$changes']) {// tslint:disable-line
      if (newState['$changes'].changes.size > 0) { // tslint:disable-line
        changed = true;
        currentStateEncoded = pack(currentState);
      }

    } else {
      currentStateEncoded = pack(currentState);
      changed = !currentStateEncoded.equals(this.previousStateEncoded);
    }

    if (changed) {
      this.patches = fossilDelta.create(this.previousStateEncoded, currentStateEncoded);

      //
      // debugging
      //
      if (debugPatch.enabled) {
        debugPatch(
          '%d bytes, %j',
          this.patches.length,
          jsonPatch.compare(unpack(this.previousStateEncoded), currentState),
        );
      }

      this.previousState = currentState;
      this.previousStateEncoded = currentStateEncoded;
    }

    return changed;
  }

}
