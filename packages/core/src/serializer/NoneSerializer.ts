import { Client } from '../transport/Transport';
import { Serializer } from './Serializer';

export class NoneSerializer<T= any> implements Serializer<T> {
  public id: string = 'none';

  public reset(data: any) {
    // tslint:disable-line
  }

  public getFullState(client?: Client) {
    return null;
  }

  public applyPatches(clients: Client[], state: T): boolean {
    return false;
  }
}
