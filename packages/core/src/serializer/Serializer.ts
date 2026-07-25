import type { Client } from '../Transport.ts';

/**
 * Per-tick timing context, populated by the Room when
 * {@link Room.defineInput} was called. Its presence makes the serializer emit
 * a {@link ProtocolModifier.TIMED} prefix on every state/patch frame — the
 * gate is per-room (defineInput), not a per-client capability.
 */
export interface PatchTimingContext {
  /** Server clock as ms since room start (`clock.elapsedTime`) at patch time. */
  sNow: number;
}

export interface Serializer<T> {
  id: string;
  reset(data: any): void;
  getFullState(client?: Client, timing?: PatchTimingContext): Uint8Array;
  applyPatches(clients: Client[], state: T, timing?: PatchTimingContext): boolean;
  handshake?(): Uint8Array;
}