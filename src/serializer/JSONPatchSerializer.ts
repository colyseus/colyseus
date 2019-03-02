import { debugPatch } from '../Debug';
import { Serializer } from './Serializer';

import * as jsonpatch from 'fast-json-patch';

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

  public getData() {
    return JSON.stringify(this.state);
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

  public getPatches() {
    return JSON.stringify(this.patches);
  }
}
