import * as jsonpatch from 'fast-json-patch';
import * as msgpack from 'notepack.io';

import { debugPatch } from '../Debug';
import { Serializer } from './Serializer';

import { Client } from '..';
import { send, Protocol } from '../Protocol';

/**
 * This serializer is not meant to be used.
 * It just ilustrates how you can implement your own data serializer.
 */
export class JSONPatchSerializer<T> implements Serializer<T> {
  public id = 'json-patch';

  private state: T;
  private observer: jsonpatch.Observer<T>;
  private patches: jsonpatch.Operation[];

  public reset(newState: any) {
    this.state = newState;
    this.observer = jsonpatch.observe(newState);
  }

  public getFullState() {
    return JSON.stringify(this.state);
  }

  public applyPatches(clients: Client[], newState: T) {
    const hasChanged  = this.hasChanged(newState);

    if (hasChanged) {
      const patches = JSON.stringify(this.patches)
      let numClients = clients.length;

      while (numClients--) {
        const client = clients[numClients];
        send[Protocol.ROOM_STATE_PATCH](client, patches as any);
      }
    }

    return hasChanged;
  }

  public hasChanged(newState: any) {
    this.patches = jsonpatch.generate(this.observer);

    const changed = (this.patches.length > 0);

    if (changed) {

      //
      // debugging
      //
      if (debugPatch.enabled) {
        debugPatch('%d bytes, %j', this.patches.length, this.patches);
      }

      this.state = newState;
    }

    return changed;
  }
}
