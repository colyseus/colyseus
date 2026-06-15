import './util';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { assert } from 'chai';

import { schema, t, Encoder, Decoder } from '@colyseus/schema';
import { Predict } from '../src/predict.ts';

// -----------------------------------------------------------------------------
// Predict per-type plan resolution.
//
// The client's prediction mode is declared EXPLICITLY on attach (or inherited
// from the Predict's defaultMode) — never inferred from the schema. The server
// declares its rewind timeline independently via `rewind.attachAll(..., { mode })`;
// keeping the two aligned is the app's responsibility (no cross-check warning).
//
// What still resolves per child constructor: the FIELD set. A type that lacks
// some of the configured fields gets its own `label:TypeName` sub-plan that
// drops them (so it never subscribes to a field it doesn't have).
// -----------------------------------------------------------------------------

const Enemy = schema({
    x: t.number(),
    y: t.number(),
    vx: t.number(),
}, "MetaEnemy");

// No `vx` — a smaller field set than the attach asks for.
const Pickup = schema({ x: t.number() }, "MetaPickup");

const GameState = schema({
    enemies: t.map(Enemy),
    pickups: t.map(Pickup),
}, "MetaLagCompState");

const step = (s: { x: number; vx: number }, dt: number) => { s.x += s.vx * dt; };
// serverNow − lastServerTime = 100ms snapshot age → reckon forwards by 100ms.
const clock = { serverNow: () => 1100, rtt: () => 100, smoothedRtt: () => 100, lastServerTime: () => 1000, sample() {} };

function roundTrip(setup: (state: any) => void) {
    const server = new GameState();
    setup(server);
    const encoder = new Encoder(server);
    const client = new GameState();
    const decoder = new Decoder(client);
    decoder.decode(Uint8Array.from(encoder.encodeAll()));
    return { server, client, decoder };
}

const enemy = (over: Record<string, number> = {}) =>
    Object.assign(new Enemy(), { x: 10, y: 0, vx: 2, ...over });

describe('Predict per-type plan resolution', () => {
    // Predicts publish a debug handle at construction — capture it to read
    // profiles (the engine's source of truth for per-type modes/labels).
    let handles: Record<string, any>;
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        handles = {};
        (globalThis as any).__colyseusDebug = { publish: (_ch: string, h: any) => { handles[h.name] = h; } };
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        delete (globalThis as any).__colyseusDebug;
        warn.mockRestore();
    });

    test('explicit mode:"reckon" dead-reckons — no schema declaration needed', () => {
        const { decoder } = roundTrip((s) => s.enemies.set('a', enemy()));
        const p = Predict.get(decoder, { mode: 'lerp', name: 'explicit', clock });
        p.attachAll('enemies', { mode: 'reckon', fields: ['x', 'y', 'vx'], step, smoothing: 0 });

        const profs = handles['explicit'].profiles();
        assert.equal(profs.find((pp: any) => pp.label === 'enemies')?.mode, 'reckon', 'attach mode is honored verbatim');

        // And it actually dead-reckons: 10 + 2 * 0.1s forward.
        const ce = (decoder.state as any).enemies.get('a');
        p.tick(0);
        assert.approximately(p.value(ce, 'x'), 10.2, 1e-6);
        assert.equal(warn.mock.calls.length, 0, 'explicit mode never warns');
    });

    test('reckon mode without any step fn throws', () => {
        const { decoder } = roundTrip((s) => s.enemies.set('a', enemy()));
        const p = Predict.get(decoder, { mode: 'lerp', name: 'nostep', clock });
        assert.throws(
            () => p.attachAll('enemies', { mode: 'reckon', fields: ['x', 'y', 'vx'] }),
            /reckon mode requires a 'step' function/,
        );
    });

    test('attaching a homogeneous collection reuses the base plan (no per-type sub-plan)', () => {
        const { decoder } = roundTrip((s) => {
            s.enemies.set('a', enemy());
            s.enemies.set('b', enemy({ x: 20 }));
        });
        const p = Predict.get(decoder, { mode: 'reckon', step, name: 'homo', clock });
        p.attachAll('enemies', { fields: ['x', 'y', 'vx'] });

        const profs = handles['homo'].profiles();
        assert.equal(profs.find((pp: any) => pp.label === 'enemies')?.mode, 'reckon');
        assert.isUndefined(profs.find((pp: any) => pp.label === 'enemies:MetaEnemy'), 'every field present → base plan');
        assert.equal(warn.mock.calls.length, 0);
    });

    test('fields a type does not declare are dropped per type (no bogus subscriptions)', () => {
        const { decoder } = roundTrip((s) => s.pickups.set('a', Object.assign(new Pickup(), { x: 3 })));
        const p = Predict.get(decoder, { mode: 'lerp', name: 'filter', clock });
        // 'vx' is not on Pickup — the configured list is filtered per constructor.
        p.attachAll('pickups', { fields: ['x', 'vx'] } as any);

        const profs = handles['filter'].profiles();
        assert.equal(profs.find((pp: any) => pp.label === 'pickups:MetaPickup')?.mode, 'lerp', 'filtered type gets its own sub-plan');
        const cp = (decoder.state as any).pickups.get('a');
        p.tick(0);
        assert.equal(p.value(cp, 'x'), 3);
    });

    test('setProfile mode flip never warns (schema-reckon tracking removed)', () => {
        const { decoder } = roundTrip((s) => s.enemies.set('a', enemy()));
        const h = (() => {
            Predict.get(decoder, { mode: 'reckon', step, name: 'flip', clock })
                .attachAll('enemies', { fields: ['x', 'y', 'vx'] });
            return handles['flip'];
        })();
        const prof = h.profiles().find((pp: any) => pp.label === 'enemies');
        h.setProfile(prof.id, { mode: 'damped' });
        assert.equal(warn.mock.calls.length, 0, 'no schema/server cross-check to warn about');
    });
});
