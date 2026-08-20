import './util';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { assert } from 'chai';

import { schema, t, Encoder, Decoder } from '@colyseus/schema';
import { Predict } from '../src/predict.ts';

// -----------------------------------------------------------------------------
// `mode:"lerp"` + `smoothMs` — a display-only output spring on the lerp result.
// Default 0 (off): the output stays the raw interpolant, bit-identical to a
// spring-less lerp. When armed, the spring keeps rendered velocity CONTINUOUS
// across imperfect snapshot streams, trailing the raw output by
// speed × smoothMs during motion — frame-rate independently (exact
// first-order-hold step).
// -----------------------------------------------------------------------------

const Unit = schema({ x: t.number() }, 'LerpDampUnit');
const DampState = schema({ units: t.map(Unit) }, 'LerpDampState');

function setup(x0 = 10) {
    const server = new DampState();
    server.units.set('a', Object.assign(new Unit(), { x: x0 }));
    const encoder = new Encoder(server);
    const decoder = new Decoder(new DampState());
    decoder.decode(Uint8Array.from(encoder.encodeAll()));
    const cu = () => (decoder.state as any).units.get('a');
    const patch = (x: number) => { server.units.get('a')!.x = x; decoder.decode(Uint8Array.from(encoder.encode())); };
    return { decoder, cu, patch };
}

describe('Predict lerp `smoothMs` (output spring)', () => {
    let now = 1000;
    let nowSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        now = 1000;
        nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    });
    afterEach(() => nowSpy.mockRestore());

    test('smoothMs omitted: raw interpolant, bit-identical to an explicit 0', () => {
        // The GOTCHA this guards: the defaults profile stores smoothMs 50 (it
        // serves damped/extrapolate) — lerp must NOT silently spring with it.
        const { decoder, cu, patch } = setup();
        const p = Predict.get(decoder, { name: 'ld-default' });
        const p0 = Predict.get(decoder, { name: 'ld-zero' });
        p.attachAll('units', { mode: 'lerp', fields: ['x'] });
        p0.attachAll('units', { mode: 'lerp', fields: ['x'], smoothMs: 0 });

        now = 1050; patch(20);
        now = 1130; p.tick(1130); p0.tick(1130);        // target 1030 → u = 0.6
        const v = p.value(cu(), 'x');
        assert.approximately(v, 16, 1e-12, 'mid-segment interpolant');
        assert.strictEqual(v, p0.value(cu(), 'x'), 'default ≡ explicit 0');

        now = 1145; patch(35);
        now = 1170; p.tick(1170); p0.tick(1170);
        assert.strictEqual(p.value(cu(), 'x'), p0.value(cu(), 'x'), 'stays identical across frames');
    });

    test('fields-array group config: smoothMs trails the raw output during motion', () => {
        const { decoder, cu, patch } = setup();
        const raw = Predict.get(decoder, { name: 'ld-raw' });
        const sm = Predict.get(decoder, { name: 'ld-sm' });
        raw.attachAll('units', { mode: 'lerp', fields: ['x'] });
        sm.attachAll('units', { mode: 'lerp', fields: ['x'], smoothMs: 30 });

        for (now = 1050; now <= 1400; now += 50) patch(10 + (now - 1000) / 5);
        for (now = 1000; now <= 1400; now += 10) { raw.tick(now); sm.tick(now); raw.value(cu(), 'x'); sm.value(cu(), 'x'); }
        now -= 10;
        const vRaw = raw.value(cu(), 'x');
        const vSm = sm.value(cu(), 'x');
        assert.isAbove(vRaw, 10, 'raw is moving');
        assert.isBelow(vSm, vRaw, 'spring trails the raw output');
        assert.isAbove(vSm, vRaw - 15, 'by a bounded distance, not stuck');
    });

    test('steady mover: trails by speed × smoothMs, independent of frame rate', () => {
        // 200 u/s stream, smoothMs 25 → trail = 200 × 0.025 = 5 u. The exact
        // first-order-hold step makes it hold at ANY tick cadence.
        const run = (tickMs: number, name: string) => {
            const { decoder, cu, patch } = setup();
            const p = Predict.get(decoder, { name });
            p.attachAll('units', { mode: 'lerp', fields: ['x'], smoothMs: 25 });
            now = 1000;
            let v = 10;
            for (now = 1000 + tickMs; now <= 2500; now += tickMs) {
                if (now % 50 === 0) patch(10 + (now - 1000) / 5);
                p.tick(now);
                v = p.value(cu(), 'x');
            }
            now = 1000;                               // reset the axis for the next run
            const rawAt2500 = 10 + (2500 - 100 - 1000) / 5;   // target = now − delay(100)
            return rawAt2500 - v;
        };
        const trailA = run(10, 'ld-60ish');
        const trailB = run(25, 'ld-40ish');
        assert.approximately(trailA, 5, 1e-6, 'trail = speed × smoothMs');
        assert.approximately(trailB, 5, 1e-6, 'same trail at a coarser tick');
    });

    test('snap: a teleport pops the spring, no glide', () => {
        const { decoder, cu, patch } = setup();
        const p = Predict.get(decoder, { name: 'ld-snap' });
        p.attachAll('units', { mode: 'lerp', fields: ['x'], snap: 4, smoothMs: 30 });

        now = 1050; patch(10.2);                  // establish cadence
        now = 3000; patch(60);                    // teleport
        now = 3060; p.tick(3060);
        assert.approximately(p.value(cu(), 'x'), 60, 1e-9, 'spring state popped with the ring');
    });

    test('per-field map config plumbs smoothMs', () => {
        const { decoder, cu, patch } = setup();
        const raw = Predict.get(decoder, { name: 'ld-map-raw' });
        const sm = Predict.get(decoder, { name: 'ld-map-sm' });
        raw.attachAll('units', { x: 'lerp' });
        sm.attachAll('units', { x: { mode: 'lerp', smoothMs: 30 } });

        for (now = 1050; now <= 1400; now += 50) patch(10 + (now - 1000) / 5);
        for (now = 1000; now <= 1400; now += 10) { raw.tick(now); sm.tick(now); raw.value(cu(), 'x'); sm.value(cu(), 'x'); }
        now -= 10;
        assert.isBelow(sm.value(cu(), 'x'), raw.value(cu(), 'x'), 'spring armed through the per-field map');
    });

    test('constructor-level smoothMs arms the spring for attaches', () => {
        const { decoder, cu, patch } = setup();
        const raw = Predict.get(decoder, { name: 'ld-ctor-raw', mode: 'lerp' });
        const sm = Predict.get(decoder, { name: 'ld-ctor-sm', mode: 'lerp', smoothMs: 30 });
        raw.attachAll('units', { fields: ['x'] });
        sm.attachAll('units', { fields: ['x'] });

        for (now = 1050; now <= 1400; now += 50) patch(10 + (now - 1000) / 5);
        for (now = 1000; now <= 1400; now += 10) { raw.tick(now); sm.tick(now); raw.value(cu(), 'x'); sm.value(cu(), 'x'); }
        now -= 10;
        assert.isBelow(sm.value(cu(), 'x'), raw.value(cu(), 'x'), 'group inherited the constructor smoothMs');
    });

    test('mode flip to damped keeps its own 50ms default (lerp 0 does not leak)', () => {
        const { decoder, cu, patch } = setup();
        const p = Predict.get(decoder, { name: 'ld-flip' });
        p.setDefaults({ mode: 'damped' });
        p.attachAll('units', { fields: ['x'] });

        now = 1050; patch(60);
        now = 1110; p.tick(1110);
        const v = p.value(cu(), 'x');
        assert.isAbove(v, 10, 'damped is chasing — smoothMs 50 intact, not frozen at 0');
        assert.isBelow(v, 60, 'still mid-glide');
    });

    test('same-frame re-reads return the same value', () => {
        const { decoder, cu, patch } = setup();
        const p = Predict.get(decoder, { name: 'ld-reread' });
        p.attachAll('units', { mode: 'lerp', fields: ['x'], smoothMs: 30 });

        now = 1050; patch(20);
        now = 1130; p.tick(1130);
        const v1 = p.value(cu(), 'x');
        assert.strictEqual(p.value(cu(), 'x'), v1, 'spring advances once per frame');
    });
});
