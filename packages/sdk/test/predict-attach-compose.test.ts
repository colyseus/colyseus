import './util';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { assert } from 'chai';

import { schema, t, Encoder, Decoder } from '@colyseus/schema';
import { Predict } from '../src/predict.ts';

// -----------------------------------------------------------------------------
// Multiple attach()/attachAll() on the same collection must COMPOSE, not clobber.
// Historically the 2nd attach blanket-detached the instance, silently dropping the
// 1st call's fields to the raw (un-interpolated) schema value. The fix makes each
// field-track idempotent and detach data-driven (walk slotByRef), so attaches add.
// -----------------------------------------------------------------------------

const Enemy = schema({ x: t.number(), y: t.number() }, 'ComposeEnemy');
const GameState = schema({ enemies: t.map(Enemy) }, 'ComposeState');

function setup() {
    const server = new GameState();
    server.enemies.set('a', Object.assign(new Enemy(), { x: 10, y: 20 }));
    const encoder = new Encoder(server);
    const decoder = new Decoder(new GameState());
    decoder.decode(Uint8Array.from(encoder.encodeAll()));
    const ce = () => (decoder.state as any).enemies.get('a');
    // Push a 2nd snapshot (x:10→20, y:20→40) — caller controls `now` around it.
    const patch = () => { const e = server.enemies.get('a')!; e.x = 20; e.y = 40; decoder.decode(Uint8Array.from(encoder.encode())); };
    return { server, decoder, ce, patch };
}

describe('Predict attach composition (no clobber)', () => {
    let handles: Record<string, any>;
    let now = 1000;
    let nowSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        handles = {};
        (globalThis as any).__colyseusDebug = { publish: (_c: string, h: any) => { handles[h.name] = h; } };
        now = 1000;
        nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    });
    afterEach(() => {
        delete (globalThis as any).__colyseusDebug;
        nowSpy.mockRestore();
    });

    test('a 2nd attachAll composes — the 1st call\'s field stays interpolated', () => {
        const { decoder, ce, patch } = setup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100, name: 'compose' });
        p.attachAll('enemies', { x: 'lerp' });   // attach #1
        p.attachAll('enemies', { y: 'lerp' });   // attach #2 — must NOT detach x

        now = 1100; patch();                     // sample#1 (t=1000) from the immediate listen, sample#2 here
        now = 1150; p.tick(1150);                // render target = 1150-100 = 1050, midway → interpolate
        assert.approximately(p.value(ce(), 'x'), 15, 0.5, 'x INTERPOLATED → attach #1 survived attach #2 (raw would be 20)');
        assert.approximately(p.value(ce(), 'y'), 30, 0.5, 'y interpolated by attach #2');
        assert.equal(handles['compose'].attachedCount(), 1, 'exactly one attached instance');
    });

    test('detach frees the instance (data-driven teardown clears every field)', () => {
        const { decoder } = setup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100, name: 'detach' });
        const off = p.attachAll('enemies', { x: 'lerp', y: 'lerp' });
        assert.equal(handles['detach'].attachedCount(), 1);
        off();
        assert.equal(handles['detach'].attachedCount(), 0, 'detach cleared the instance');
    });

    test('re-attaching the same field replaces its mode without losing the field', () => {
        const { decoder, ce, patch } = setup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100, name: 'replace' });
        p.attachAll('enemies', { x: 'lerp' });
        now = 1100; patch();
        now = 1150; p.tick(1150);
        assert.approximately(p.value(ce(), 'x'), 15, 0.5, 'lerp interpolates to the midpoint');

        // Replace x's mode in place; still exactly one instance, x still tracked, and it
        // now reads the latest-ish (damped) value rather than the lerp midpoint.
        p.attachAll('enemies', { x: 'damped', smoothMs: 25 });
        assert.equal(handles['replace'].attachedCount(), 1, 'no phantom instance after re-attach');
        now = 1160; p.tick(1160);
        assert.isAbove(p.value(ce(), 'x'), 18, 'x switched to damped (toward latest 20), not the lerp 15');
    });
});
