import './util';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { assert } from 'chai';

import { schema, t, Encoder, Decoder } from '@colyseus/schema';
import { Predict } from '../src/predict.ts';

// -----------------------------------------------------------------------------
// Schema-declared lag comp → Predict mode inference.
//
// The entity TYPE declares its lag-comp behavior ONCE in the shared schema
// (`schema({...}, "Enemy").with({ lagComp: "reckon" })`); the server's Rewind aims its
// rewind reads by it, and Predict infers the per-child attach mode from the
// same declaration. Priority: explicit attach `mode` > schema declaration >
// the Predict's defaultMode. Mixed-type collections resolve per constructor —
// each diverging type gets its own `label:TypeName` sub-plan/profile.
// -----------------------------------------------------------------------------

const Enemy = schema({
    x: t.number(),
    y: t.number(),
    vx: t.number(),
}, "MetaEnemy").with({ lagComp: "reckon" });

// Subclass opt-out: explicit "snapshot" shadows the inherited "reckon".
const LerpedEnemy = Enemy.extend({}, "MetaLerped").with({ lagComp: "snapshot" });

// No declaration at all (and a smaller field set than the attach asks for).
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

describe('schema lagComp → Predict mode inference', () => {
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

    test('lagComp:"reckon" infers mode "reckon" under a lerp-default Predict (per-type sub-plan)', () => {
        const { decoder } = roundTrip((s) => s.enemies.set('a', enemy()));
        const p = Predict.get(decoder, { mode: 'lerp', name: 'infer', clock });
        p.attachAll('enemies', { fields: ['x', 'y', 'vx'], step, smoothing: 0 } as any);

        const profs = handles['infer'].profiles();
        const sub = profs.find((pp: any) => pp.label === 'enemies:MetaEnemy');
        assert.equal(sub?.mode, 'reckon', 'type-inferred sub-plan owns a reckon profile');

        // And it actually dead-reckons: 10 + 2 * 0.1s forward.
        const ce = (decoder.state as any).enemies.get('a');
        p.tick(0);
        assert.approximately(p.value(ce, 'x'), 10.2, 1e-6);
        assert.equal(warn.mock.calls.length, 0, 'inference is not a contradiction — no warning');
    });

    test('reckon-default Predict + declared "reckon" agree → base plan reused (no sub-plan)', () => {
        const { decoder } = roundTrip((s) => s.enemies.set('a', enemy()));
        const p = Predict.get(decoder, { mode: 'reckon', step, name: 'agree', clock });
        p.attachAll('enemies', { fields: ['x', 'y', 'vx'] });

        const profs = handles['agree'].profiles();
        assert.equal(profs.find((pp: any) => pp.label === 'enemies')?.mode, 'reckon');
        assert.isUndefined(profs.find((pp: any) => pp.label === 'enemies:MetaEnemy'), 'agreeing type reuses the base plan');
        assert.equal(warn.mock.calls.length, 0);
    });

    test('schema-inferred reckon without any step fn throws, naming the type', () => {
        const { decoder } = roundTrip((s) => s.enemies.set('a', enemy()));
        const p = Predict.get(decoder, { mode: 'lerp', name: 'nostep', clock });
        assert.throws(
            () => p.attachAll('enemies', { fields: ['x', 'y', 'vx'] }),
            /MetaEnemy.*lagComp: "reckon"/,
        );
    });

    test('explicit attach mode wins over the declaration — one warning per (group, type)', () => {
        const { decoder } = roundTrip((s) => {
            s.enemies.set('a', enemy());
            s.enemies.set('b', enemy({ x: 20 }));
        });
        const p = Predict.get(decoder, { mode: 'lerp', name: 'override', clock });
        p.attachAll('enemies', { mode: 'lerp', fields: ['x', 'y', 'vx'] });

        const profs = handles['override'].profiles();
        assert.equal(profs.find((pp: any) => pp.label === 'enemies')?.mode, 'lerp', 'explicit mode wins');
        assert.equal(warn.mock.calls.length, 1, 'warned once for two children of the same type');
        assert.match(String(warn.mock.calls[0][0]), /MetaEnemy.*lagComp: "reckon".*mode "lerp"/s);
    });

    test('mixed collection: "snapshot" subclass opts out of the reckon default → own lerp sub-plan', () => {
        const { decoder } = roundTrip((s) => {
            s.enemies.set('a', enemy());
            s.enemies.set('b', Object.assign(new LerpedEnemy(), { x: 5, y: 0, vx: 1 }));
        });
        const p = Predict.get(decoder, { mode: 'reckon', step, name: 'mixed', clock });
        p.attachAll('enemies', { fields: ['x', 'y', 'vx'] });

        const profs = handles['mixed'].profiles();
        assert.equal(profs.find((pp: any) => pp.label === 'enemies')?.mode, 'reckon', 'declared type rides the base plan');
        assert.equal(profs.find((pp: any) => pp.label === 'enemies:MetaLerped')?.mode, 'lerp', 'opt-out subclass gets its own lerp sub-plan');
        assert.equal(warn.mock.calls.length, 0, 'a schema-level opt-out is not a contradiction');
    });

    test('panel flip off "reckon" on a schema-reckoned profile warns with the type name', () => {
        const { decoder } = roundTrip((s) => s.enemies.set('a', enemy()));
        Predict.get(decoder, { mode: 'reckon', step, name: 'flip', clock })
            .attachAll('enemies', { fields: ['x', 'y', 'vx'] });

        const h = handles['flip'];
        const prof = h.profiles().find((pp: any) => pp.label === 'enemies');
        h.setProfile(prof.id, { mode: 'damped' });
        assert.equal(warn.mock.calls.length, 1);
        assert.match(String(warn.mock.calls[0][0]), /MetaEnemy.*desyncs/s);

        // Flipping params (not mode) never warns.
        h.setProfile(prof.id, { damping: 5 });
        assert.equal(warn.mock.calls.length, 1);
    });

    test('fields a type does not declare are dropped per type (no bogus subscriptions)', () => {
        const { decoder } = roundTrip((s) => s.pickups.set('a', Object.assign(new Pickup(), { x: 3 })));
        const p = Predict.get(decoder, { mode: 'lerp', name: 'filter', clock });
        // 'vx' is not on Pickup — the union list is filtered per constructor.
        p.attachAll('pickups', { fields: ['x', 'vx'] } as any);

        const profs = handles['filter'].profiles();
        assert.equal(profs.find((pp: any) => pp.label === 'pickups:MetaPickup')?.mode, 'lerp', 'filtered type gets its own sub-plan');
        const cp = (decoder.state as any).pickups.get('a');
        p.tick(0);
        assert.equal(p.value(cp, 'x'), 3);
    });
});
