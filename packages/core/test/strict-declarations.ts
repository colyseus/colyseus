/**
 * Compile-only regression test for the published type declarations.
 *
 * Compiled as a strict NodeNext consumer (`strict: true`, `skipLibCheck:
 * false` — see tsconfig.json) against the `build/` output, resolved through
 * this package's own `exports` map, exactly as an external project would.
 *
 * Run with `pnpm --filter @colyseus/core test`. Never executed at runtime.
 */
import { EventEmitter } from 'node:events';
import {
  type Client,
  LocalPresence,
  Room,
  type RoomOptions,
} from '@colyseus/core';
import {
  OnCreateException,
  OnDropException,
  OnJoinException,
  OnLeaveException,
  OnReconnectException,
} from '@colyseus/core/errors/RoomExceptions';

// ─── assertion helpers ──────────────────────────────────────────────────────

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// ─── RoomExceptions: hook parameter inference ───────────────────────────────
// Lifecycle hooks are optional on Room; exception types must still infer
// their parameter types from a subclass's overrides.

interface StrictRoomOptions extends RoomOptions {
  state: { count: number };
  client: Client;
}

class StrictRoom extends Room<StrictRoomOptions> {
  override onCreate(options: { seed: string }) {}
  override onJoin(client: Client, options?: { name: string }, auth?: { id: string }) {}
  override onLeave(client: Client, code?: 4000 | 4001) {}
  override onDrop(client: Client, code?: 4002 | 4003) {}
  override onReconnect(client: Client) {}
}

type _HookInference = [
  Expect<Equal<OnCreateException<StrictRoom>['options'], { seed: string }>>,
  Expect<Equal<OnJoinException<StrictRoom>['client'], Client>>,
  Expect<Equal<OnJoinException<StrictRoom>['options'], { name: string } | undefined>>,
  Expect<Equal<OnJoinException<StrictRoom>['auth'], { id: string } | undefined>>,
  Expect<Equal<OnLeaveException<StrictRoom>['client'], Client>>,
  Expect<Equal<OnLeaveException<StrictRoom>['consented'], 4000 | 4001 | undefined>>,
  Expect<Equal<OnDropException<StrictRoom>['client'], Client>>,
  Expect<Equal<OnDropException<StrictRoom>['code'], 4002 | 4003 | undefined>>,
  Expect<Equal<OnReconnectException<StrictRoom>['client'], Client>>,
];

// ─── LocalPresence: EventEmitter declaration emit ───────────────────────────
// Guards against declaration emit narrowing the inferred type to
// EventEmitter<[never]>, which rejects every .on()/.emit() call.

type _Subscriptions = Expect<Equal<LocalPresence['subscriptions'], EventEmitter>>;
