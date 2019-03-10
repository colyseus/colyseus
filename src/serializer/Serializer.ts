import { Client } from '..';

export function serialize(serializer: new () => Serializer<any>) {
  return (constructor: Function) => {
    constructor.prototype._getSerializer = () => new serializer();
  };
}

export interface Serializer<T> {
  id: string;
  reset(data: any): void;
  getFullState(client: Client): any;
  applyPatches(clients: Client[], state: T): boolean;
  handshake?(): number[];
}
