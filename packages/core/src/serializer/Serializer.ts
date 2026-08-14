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

  /**
   * Whether the state declares at least one `@unreliable` field. Computed once
   * in {@link Serializer.reset}; the Room reads it once to decide whether to arm
   * the unreliable flush at all. Never consulted on the tick path — a room that
   * doesn't use the channel must not pay for it.
   */
  hasUnreliableFields?: boolean;

  /**
   * Encode and send the UNRELIABLE channel to every client whose transport
   * exposes {@link Client.rawUnreliable}. Only called on rooms where
   * {@link Serializer.hasUnreliableFields} is true.
   *
   * Runs on its own cadence, independent of {@link Serializer.applyPatches}.
   */
  applyUnreliablePatches?(clients: Client[]): boolean;
}