import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { Room, RoomPlugin, definePlugins } from '@colyseus/core';

import { GeoIPPlugin } from '../src/GeoIPPlugin.ts';
import { MMDBReader } from '../src/readers/MMDBReader.ts';
import type { GeoIPData, GeoIPReader } from '../src/types.ts';

/**
 * Two layers of tests live here:
 *   1. `GeoIPPlugin` unit tests — use a `MockReader` to drive the onAuth
 *      hot path in isolation, bypassing the on-disk load.
 *   2. `MMDBReader + bundled-path` integration tests — exercise the real
 *      load path against the MaxMind-provided test fixture
 *      `test/fixtures/GeoLite2-Country-Test.mmdb` (Apache-2.0, see
 *      `fixtures/NOTICE.md`). This catches regressions in actual MMDB
 *      decoding and the field mapping in `MMDBReader`.
 *
 * Cross-process behavior of `AutoDownloader` (HTTP fetch, tar extract,
 * atomic rename, PID-scoped temps) still needs network access and lives
 * in a follow-up suite.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_MMDB = path.join(__dirname, 'fixtures', 'GeoLite2-Country-Test.mmdb');

const runInit = (room: any) => room.__init();

class MockReader implements GeoIPReader {
  private map: Record<string, GeoIPData>;
  constructor(map: Record<string, GeoIPData>) { this.map = map; }
  lookup(ip: string): GeoIPData | undefined { return this.map[ip]; }
}

describe('GeoIPPlugin', () => {
  it('attaches client.geoip during onAuth (before onJoin)', async () => {
    const plugin = new GeoIPPlugin({ dbPath: '/unused' });
    (plugin as any).reader = new MockReader({
      '203.0.113.5': { isoCode: 'BR', name: 'Brazil', continent: 'SA' },
    });

    let seenInOnJoin: GeoIPData | undefined;
    class R extends Room {
      plugins = definePlugins([plugin]);
      onJoin(client: any) { seenInOnJoin = client.geoip; }
    }
    const room = new R();
    runInit(room);

    const client: any = { sessionId: 's1' };
    const ctx: any = { ip: '203.0.113.5', headers: new Headers() };
    await (room as any).onAuth(client, {}, ctx);
    await (room as any).onJoin(client, {});

    assert.deepEqual(client.geoip, { isoCode: 'BR', name: 'Brazil', continent: 'SA' });
    assert.equal(seenInOnJoin?.isoCode, 'BR', 'geoip is set by the time onJoin runs');
  });

  it('leaves client.geoip undefined for unresolvable IPs', async () => {
    const plugin = new GeoIPPlugin({ dbPath: '/unused' });
    (plugin as any).reader = new MockReader({});

    class R extends Room {
      plugins = definePlugins([plugin]);
    }
    const room = new R();
    runInit(room);

    const client: any = { sessionId: 's1' };
    await (room as any).onAuth(client, {}, { ip: '127.0.0.1', headers: new Headers() });
    assert.equal(client.geoip, undefined);
  });

  it('handles x-forwarded-for comma-list IPs by taking the left-most', async () => {
    const plugin = new GeoIPPlugin({ dbPath: '/unused' });
    (plugin as any).reader = new MockReader({
      '198.51.100.7': { isoCode: 'US', name: 'United States', continent: 'NA' },
    });

    class R extends Room {
      plugins = definePlugins([plugin]);
    }
    const room = new R();
    runInit(room);

    const client: any = { sessionId: 's1' };
    await (room as any).onAuth(client, {}, {
      ip: '198.51.100.7, 10.0.0.1, 10.0.0.2',
      headers: new Headers(),
    });
    assert.equal(client.geoip?.isoCode, 'US');
  });

  it('survives reader exceptions without blocking the join', async () => {
    const plugin = new GeoIPPlugin({ dbPath: '/unused' });
    (plugin as any).reader = {
      lookup() { throw new Error('reader exploded'); },
    } as GeoIPReader;

    class R extends Room {
      plugins = definePlugins([plugin]);
    }
    const room = new R();
    runInit(room);

    const client: any = { sessionId: 's1' };
    // Should not throw.
    await (room as any).onAuth(client, {}, { ip: '203.0.113.5', headers: new Headers() });
    assert.equal(client.geoip, undefined);
  });

  it('runs before the room\'s own onAuth (default plugin order)', async () => {
    const order: string[] = [];
    const plugin = new GeoIPPlugin({ dbPath: '/unused' });
    (plugin as any).reader = new MockReader({
      '203.0.113.5': { isoCode: 'BR', name: 'Brazil', continent: 'SA' },
    });

    class R extends Room {
      plugins = definePlugins([plugin]);
      onAuth(client: any) {
        order.push('room-onAuth');
        // By the time the room sees onAuth, plugin already attached geoip.
        assert.equal(client.geoip?.isoCode, 'BR');
        return { ok: true };
      }
    }
    const room = new R();
    runInit(room);

    const client: any = { sessionId: 's1' };
    await (room as any).onAuth(client, {}, { ip: '203.0.113.5', headers: new Headers() });
    assert.deepEqual(order, ['room-onAuth']);
  });
});

describe('MMDBReader (real fixture)', () => {
  // IPs and expected results pulled from the MaxMind-DB test fixture.
  // `is_in_european_union` is only stamped on the `country` record for
  // the Swedish range — UK ranges in this fixture are marked at the
  // `registered_country` level, which the reader (by design) ignores.

  it('resolves an IPv4 to its country', () => {
    const reader = new MMDBReader(FIXTURE_MMDB);
    const data = reader.lookup('81.2.69.142');
    assert.deepEqual(data, {
      isoCode: 'GB',
      name: 'United Kingdom',
      continent: 'EU',
      isInEU: undefined,
    });
  });

  it('sets isInEU when the country record has the flag (Sweden)', () => {
    const reader = new MMDBReader(FIXTURE_MMDB);
    const data = reader.lookup('89.160.20.112');
    assert.equal(data?.isoCode, 'SE');
    assert.equal(data?.isInEU, true);
  });

  it('resolves an IPv6 address', () => {
    const reader = new MMDBReader(FIXTURE_MMDB);
    const data = reader.lookup('2001:218::1');
    assert.equal(data?.isoCode, 'JP');
    assert.equal(data?.continent, 'AS');
  });

  it('returns undefined for IPs absent from the database', () => {
    const reader = new MMDBReader(FIXTURE_MMDB);
    assert.equal(reader.lookup('1.1.1.1'), undefined);
  });

  it('returns undefined for malformed IPs without throwing', () => {
    const reader = new MMDBReader(FIXTURE_MMDB);
    assert.equal(reader.lookup('not-an-ip'), undefined);
  });

  it('exposes lookup() via this.plugins.geoip from inside the room', async () => {
    const plugin = new GeoIPPlugin({ dbPath: FIXTURE_MMDB });

    let fromInsideRoom: GeoIPData | undefined;
    class R extends Room {
      plugins = definePlugins([plugin]);
      onJoin() {
        // Same API the docs promise — directly callable from room code.
        fromInsideRoom = this.plugins.geoip.lookup('81.2.69.142');
      }
    }
    const room = new R();
    runInit(room);
    await (room as any).onCreate({});
    await (room as any).onJoin({} as any, {});

    assert.equal(fromInsideRoom?.isoCode, 'GB');
    assert.equal(fromInsideRoom?.continent, 'EU');
  });

  it('lookup() returns undefined for malformed IPs and missing reader', () => {
    const plugin = new GeoIPPlugin({ dbPath: FIXTURE_MMDB });
    // Reader not loaded yet (onCreate hasn't run).
    assert.equal(plugin.lookup('81.2.69.142'), undefined);
    assert.equal(plugin.lookup(''), undefined);
  });

  it('loads via GeoIPPlugin.onCreate end-to-end', async () => {
    const plugin = new GeoIPPlugin({ dbPath: FIXTURE_MMDB });

    class R extends Room {
      plugins = definePlugins([plugin]);
    }
    const room = new R();
    runInit(room);
    // Drive the plugin's onCreate (which triggers the real disk load).
    await (room as any).onCreate({});

    const client: any = { sessionId: 's1' };
    await (room as any).onAuth(client, {}, { ip: '81.2.69.142', headers: new Headers() });
    assert.equal(client.geoip?.isoCode, 'GB');
    assert.equal(client.geoip?.continent, 'EU');
  });
});
