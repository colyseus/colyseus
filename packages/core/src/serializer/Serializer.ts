import type { Client } from '../Transport.ts';

export interface Serializer<T> {
  id: string;
  reset(data: any): void;
  getFullState(client?: Client): Uint8Array;
  applyPatches(clients: Client[], state: T): boolean;
  handshake?(): Uint8Array;
}