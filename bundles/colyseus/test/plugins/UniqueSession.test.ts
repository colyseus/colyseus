import assert from 'assert';
import { Client as SDKClient } from '@colyseus/sdk';
import {
  type Client, type MatchMakerDriver, type Presence, type Transport,
  matchMaker, Room, Server, definePlugins,
} from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DRIVERS, PRESENCE_IMPLEMENTATIONS, timeout } from '../utils/index.ts';
import { UniqueSessionPlugin } from '../../src/plugins/unique-session.ts';

/**
 * End-to-end coverage for UniqueSessionPlugin. Spins up a real Server +
 * WebSocket transport per (driver, presence) combination, defines a
 * couple of rooms with the plugin attached, and drives the actual SDK
 * Client through join/leave to assert real-wire behavior — not just
 * the in-process plugin logic.
 *
 * userId is sourced from the join `options.userId` and forwarded onto
 * the Client via `onAuth` (the same place real games would surface
 * their JWT or session id). Anonymous joins simply omit it.
 */

const TEST_PORT = 8568;
const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

/** Room factory — produces a class with the plugin pre-attached so
 *  each test can register a fresh roomType with its own plugin
 *  configuration via `matchMaker.defineRoomType`. */
function uniqueRoom(opts: ConstructorParameters<typeof UniqueSessionPlugin>[0] = {}) {
  return class extends Room {
    plugins = definePlugins({
      unique: new UniqueSessionPlugin(opts),
    });
    async onAuth(_client: Client, options: any) {
      // Returning `{ id: ... }` becomes `client.auth.id`, which is
      // both where the framework's `trackRoomJoin` reads (via
      // `client.auth?.id`) AND the plugin's default lookup
      // (`['auth.id', 'auth.userId']`). Apps using @colyseus/auth's
      // default JWT flow get this shape for free.
      if (options?.userId) { return { id: options.userId }; }
      return true;
    }
  };
}

describe('UniqueSessionPlugin (e2e)', () => {
  for (let i = 0; i < PRESENCE_IMPLEMENTATIONS.length; i++) {
    for (let j = 0; j < DRIVERS.length; j++) {
      describe(`Driver => ${DRIVERS[j].name}, Presence => ${PRESENCE_IMPLEMENTATIONS[i].name}`, () => {
        let driver: MatchMakerDriver;
        let server: Server;
        let presence: Presence;
        let transport: Transport;

        const client = new SDKClient(TEST_ENDPOINT);

        before(async () => {
          driver = new DRIVERS[j]();
          presence = new PRESENCE_IMPLEMENTATIONS[i]();
          transport = new WebSocketTransport({ pingInterval: 100, pingMaxRetries: 3 });

          server = new Server({
            greet: false, gracefullyShutdown: false,
            presence, driver, transport,
          });

          await matchMaker.setup(presence, driver);
          await server.listen(TEST_PORT);
        });

        beforeEach(async () => {
          await matchMaker.stats.reset();
          await driver.clear();
        });

        after(async () => {
          await driver.clear();
          await server.gracefullyShutdown(false);
        });

        it('allows the first join and rejects a second concurrent join from the same user', async () => {
          matchMaker.defineRoomType('unique', uniqueRoom({ max: 1 }));

          const first = await client.joinOrCreate('unique', { userId: 'alice' });
          // Give trackRoomJoin a tick to land in Presence before the next
          // join queries the reverse index.
          await timeout(50);

          await assert.rejects(
            async () => await client.joinOrCreate('unique', { userId: 'alice' }),
            (err: any) => /already_in_room/.test(err?.message ?? ''),
          );

          await first.leave();
        });

        it('lets the user back in after they leave', async () => {
          matchMaker.defineRoomType('unique', uniqueRoom({ max: 1 }));

          const first = await client.joinOrCreate('unique', { userId: 'alice' });
          await timeout(50);
          await first.leave();
          // Presence cleanup happens in onLeave's framework path; give it
          // a tick so the index reflects the departure.
          await timeout(100);

          const second = await client.joinOrCreate('unique', { userId: 'alice' });
          await second.leave();
        });

        it('allows truly-anonymous joins (no auth payload) regardless of existing sessions', async () => {
          matchMaker.defineRoomType('unique', uniqueRoom({ max: 1 }));

          // No auth returned at all → no stable id → plugin no-op.
          // Anonymous-but-registered sessions from @colyseus/auth
          // (which return `{ id, anonymousId, anonymous: true }` and
          // therefore DO carry an `auth.id`) are covered by the
          // "rejects the second concurrent join" case above — that
          // test doesn't care whether the email-backed or the
          // anon-registered code path produced the id.
          const a = await client.joinOrCreate('unique');
          await timeout(50);
          const b = await client.joinOrCreate('unique');

          await a.leave();
          await b.leave();
        });

        it('allows max=2 concurrent sessions per user, rejects the third', async () => {
          matchMaker.defineRoomType('unique', uniqueRoom({ max: 2 }));

          const r1 = await client.joinOrCreate('unique', { userId: 'alice' });
          await timeout(50);
          const r2 = await client.joinOrCreate('unique', { userId: 'alice' });
          await timeout(50);

          await assert.rejects(
            async () => await client.joinOrCreate('unique', { userId: 'alice' }),
            (err: any) => /already_in_room/.test(err?.message ?? ''),
          );

          await r1.leave();
          await r2.leave();
        });

        it("isolates the check by roomName: the same user can join a different room type", async () => {
          matchMaker.defineRoomType('uniqueA', uniqueRoom({ max: 1 }));
          matchMaker.defineRoomType('uniqueB', uniqueRoom({ max: 1 }));

          const a = await client.joinOrCreate('uniqueA', { userId: 'alice' });
          await timeout(50);
          const b = await client.joinOrCreate('uniqueB', { userId: 'alice' });

          await a.leave();
          await b.leave();
        });

        it("'replace' mode kicks the older session and lets the new join through", async () => {
          matchMaker.defineRoomType('uniqueReplace', uniqueRoom({
            max: 1,
            onDuplicate: 'replace',
          }));

          const older = await client.joinOrCreate('uniqueReplace', { userId: 'alice' });
          // Wait for the disconnect to fire on the older session AFTER
          // the new join lands — we assert by hooking onLeave first.
          const olderLeft = new Promise<void>((resolve) => {
            older.onLeave(() => resolve());
          });
          await timeout(50);

          const newer = await client.joinOrCreate('uniqueReplace', { userId: 'alice' });
          await olderLeft;

          await newer.leave();
        });

        it('uses the configured rejectCode and rejectMessage', async () => {
          matchMaker.defineRoomType('uniqueCustom', uniqueRoom({
            max: 1,
            rejectCode: 4499,
            rejectMessage: 'one_match_at_a_time',
          }));

          const first = await client.joinOrCreate('uniqueCustom', { userId: 'alice' });
          await timeout(50);

          await assert.rejects(
            async () => await client.joinOrCreate('uniqueCustom', { userId: 'alice' }),
            (err: any) => {
              // Either code or message should carry the custom value
              // depending on which surface the SDK exposes.
              return err?.code === 4499 || /one_match_at_a_time/.test(err?.message ?? '');
            },
          );

          await first.leave();
        });

        it('resolveUserId: custom function lets non-standard auth shapes work', async () => {
          // Auth flow that puts the user id under `client.auth.profile.sub`
          // (typical raw-OIDC payload). The default extractor wouldn't
          // find it, but `resolveUserId` lets the app dig into its
          // own shape.
          //
          // Note: the framework's `trackRoomJoin` reads
          // `client.userId ?? client.auth?.id` — so we ALSO set
          // `auth.id` in the returned object to make sure the index
          // entry is keyed under the same id the plugin's extractor
          // returns. This mirrors a realistic app shape.
          matchMaker.defineRoomType('uniqueCustomField', class extends Room {
            plugins = definePlugins({
              unique: new UniqueSessionPlugin({
                max: 1,
                resolveUserId: (c) => (c as any).auth?.profile?.sub,
              }),
            });
            async onAuth(_c: Client, opts: any) {
              if (opts?.userId) {
                return { id: opts.userId, profile: { sub: opts.userId } };
              }
              return true;
            }
          });

          const first = await client.joinOrCreate('uniqueCustomField', { userId: 'alice' });
          await timeout(50);

          await assert.rejects(
            async () => await client.joinOrCreate('uniqueCustomField', { userId: 'alice' }),
            (err: any) => /already_in_room/.test(err?.message ?? ''),
          );

          await first.leave();
        });

        it('respects conflictsWith predicate to scope by roomId pattern', async () => {
          matchMaker.defineRoomType('uniqueScoped', uniqueRoom({
            max: 1,
            // Only count entries pointing at the OTHER room instance
            // — i.e., the current room never conflicts with itself
            // via the predicate. Reaching here means the entry survived
            // every other filter (roomName match, not the current
            // roomId), so this just toggles "count or skip" by the
            // entry's joinedAt. Using a coarse predicate that always
            // returns true is equivalent to the default behavior; this
            // test asserts the false-path passes through cleanly.
            conflictsWith: () => false,
          }));

          const first = await client.joinOrCreate('uniqueScoped', { userId: 'alice' });
          await timeout(50);
          // Predicate returns false for everything ⇒ no conflicts
          // counted ⇒ second join should succeed.
          const second = await client.joinOrCreate('uniqueScoped', { userId: 'alice' });

          await first.leave();
          await second.leave();
        });

        it('conflictsWith receives currentRoom — only counts self-room duplicates', async () => {
          // Predicate counts an existing session as a conflict ONLY
          // when it's in the same room instance as the joining
          // client. For self-room entries `existing.room` is
          // undefined; for cross-room it carries IRoomCache. This
          // exercises both branches.
          matchMaker.defineRoomType('uniqueSelfOnly', uniqueRoom({
            max: 1,
            conflictsWith: (existing, currentRoom) => {
              // `existing.room === undefined` ⇔ same room instance
              // as `currentRoom`. Returning true here = count it.
              return existing.room === undefined
                || existing.room.roomId === currentRoom.roomId;
            },
          }));

          // First join creates room A.
          const first = await client.joinOrCreate('uniqueSelfOnly', { userId: 'alice' });
          await timeout(50);

          // Second join from the same user goes to room A (joinOrCreate
          // reuses unlocked rooms). That's a self-room conflict and
          // should be rejected.
          await assert.rejects(
            async () => await client.joinOrCreate('uniqueSelfOnly', { userId: 'alice' }),
            (err: any) => /already_in_room/.test(err?.message ?? ''),
          );

          await first.leave();
        });
      });
    }
  }
});
