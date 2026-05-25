import type { Client } from '../Transport.ts';

/**
 * Per-tick timing context, populated by the Room when
 * {@link Room.defineInput} was called. The serializer uses it to emit a
 * {@link ProtocolModifier.TIMED} prefix for clients that advertised
 * the {@link HandshakeSection.CLIENT_TIMING} capability.
 */
export interface PatchTimingContext {
  /** `performance.now()` at the moment the patch is being applied. */
  sNow: number;
}

export interface Serializer<T> {
  id: string;
  reset(data: any): void;
  getFullState(client?: Client, timing?: PatchTimingContext): Uint8Array;
  applyPatches(clients: Client[], state: T, timing?: PatchTimingContext): boolean;
  handshake?(): Uint8Array;
}