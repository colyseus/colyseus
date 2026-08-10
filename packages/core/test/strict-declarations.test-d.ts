/**
 * Compile-only regression tests for the published type declarations.
 *
 * Typechecked (never executed) by vitest typecheck mode as a strict NodeNext
 * consumer (`strict: true`, `skipLibCheck: false` — see tsconfig.json)
 * against the `build/` output, resolved through this package's own `exports`
 * map, exactly as an external project would.
 *
 * Run with `pnpm --filter @colyseus/core test`. Requires `build/` to exist —
 * run the root build first.
 */
import { EventEmitter } from 'node:events';
import { describe, expectTypeOf, it } from 'vitest';
import {
  type Client,
  LocalPresence,
  matchMaker,
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

describe('RoomExceptions: hook parameter inference', () => {
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

  it('infers hook parameter types from subclass overrides', () => {
    expectTypeOf<OnCreateException<StrictRoom>['options']>().toEqualTypeOf<{ seed: string }>();
    expectTypeOf<OnJoinException<StrictRoom>['client']>().toEqualTypeOf<Client>();
    expectTypeOf<OnJoinException<StrictRoom>['options']>().toEqualTypeOf<{ name: string } | undefined>();
    expectTypeOf<OnJoinException<StrictRoom>['auth']>().toEqualTypeOf<{ id: string } | undefined>();
    expectTypeOf<OnLeaveException<StrictRoom>['client']>().toEqualTypeOf<Client>();
    expectTypeOf<OnLeaveException<StrictRoom>['consented']>().toEqualTypeOf<4000 | 4001 | undefined>();
    expectTypeOf<OnDropException<StrictRoom>['client']>().toEqualTypeOf<Client>();
    expectTypeOf<OnDropException<StrictRoom>['code']>().toEqualTypeOf<4002 | 4003 | undefined>();
    expectTypeOf<OnReconnectException<StrictRoom>['client']>().toEqualTypeOf<Client>();
  });
});

describe('matchMaker.remoteRoomCall: return type inference', () => {
  // With both type arguments, the return type must come from that single
  // member — not a union of every TRoom member.

  class SeatsRoom extends Room {
    seatCount = 4;
    getSeatsInfo() {
      return [{ seatNo: 0, occupied: true }];
    }
    async getOwnerId() {
      return 'owner';
    }
  }

  it('resolves the awaited return type of a single method', () => {
    expectTypeOf<
      Awaited<ReturnType<typeof matchMaker.remoteRoomCall<SeatsRoom, 'getSeatsInfo'>>>
    >().toEqualTypeOf<{ seatNo: number; occupied: boolean }[]>();
  });

  it('unwraps the promise of an async method', () => {
    expectTypeOf<
      Awaited<ReturnType<typeof matchMaker.remoteRoomCall<SeatsRoom, 'getOwnerId'>>>
    >().toEqualTypeOf<string>();
  });

  it('resolves a property to its own type', () => {
    expectTypeOf<
      Awaited<ReturnType<typeof matchMaker.remoteRoomCall<SeatsRoom, 'seatCount'>>>
    >().toEqualTypeOf<number>();
  });

  it('infers the method literal when no type arguments are given', async () => {
    const inferred = await matchMaker.remoteRoomCall('room-id', 'checkReconnectionToken');
    expectTypeOf(inferred).toEqualTypeOf<Awaited<ReturnType<Room['checkReconnectionToken']>>>();
  });

  it('degrades to `any` when only TRoom is given', async () => {
    // TypeScript applies TMethod's default instead of inferring the literal
    // (microsoft/TypeScript#26242) — result degrades to `any`, NOT a union of
    // every member. If this assertion ever fails, TypeScript gained partial
    // inference: make this case precise and update the remoteRoomCall() docs.
    const partial = await matchMaker.remoteRoomCall<SeatsRoom>('room-id', 'getSeatsInfo');
    expectTypeOf(partial).toBeAny();
  });

  it('allows dynamic method names not present on the room type', async () => {
    // rooms defined via defineRoomType() have methods unknown to the compiler
    const dynamic = await matchMaker.remoteRoomCall('room-id', 'customDynamicMethod');
    expectTypeOf(dynamic).toBeAny();
  });
});

describe('LocalPresence: EventEmitter declaration emit', () => {
  // Guards against declaration emit narrowing the inferred type to
  // EventEmitter<[never]>, which rejects every .on()/.emit() call.

  it('keeps `subscriptions` as a plain EventEmitter', () => {
    expectTypeOf<LocalPresence['subscriptions']>().toEqualTypeOf<EventEmitter>();
  });
});
