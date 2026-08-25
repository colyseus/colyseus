import type { Client } from '../Transport.ts';
import type { PatchTimingContext, Serializer } from './Serializer.ts';

export class NoneSerializer<T= any> implements Serializer<T> {
  public id: string = 'none';

  public reset(data: any) {}

  public getFullState(_client?: Client, _timing?: PatchTimingContext) {
    return null;
  }

  public applyPatches(_clients: Client[], _state: T, _timing?: PatchTimingContext): boolean {
    return false;
  }
}
