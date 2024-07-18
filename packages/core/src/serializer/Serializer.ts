import { Client } from '../Transport.js';

export interface Serializer<T> {
  id: string;
  reset(data: any): void;
  getFullState(client?: Client): Buffer;
  applyPatches(clients: Client[], state: T): boolean;
  handshake?(): Buffer;
}
