import { Serializer } from './Serializer';
import { debugPatch } from '../Debug';

import * as jsonpatch from 'fast-json-patch'; 

export class JSONPatchSerializer<T> implements Serializer<T> {
  public id = "json-patch";

  private state: T;
  private observer: jsonpatch.Observer<T>;
  private patches: jsonpatch.Operation[];

  public reset(newState: any) {
    this.state = newState;
    this.observer = jsonpatch.observe(newState);
  }

  public getData() {
    return this.state;
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
    return this.patches;
  }
}
