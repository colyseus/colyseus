import type { Client } from '../Transport.ts';
import type { Serializer } from './Serializer.ts';

export class NoneSerializer<T= any> implements Serializer<T> {
  public id: string = 'none';

  public reset(data: any) {}

  public getFullState(client?: Client) {
    return null;
  }

  public applyPatches(clients: Client[], state: T): boolean {
    return false;
  }
}
