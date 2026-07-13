import './util';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { assert } from 'chai';

import { schema, t, Encoder, Decoder } from '@colyseus/schema';
import { Predict } from '../src/predict.ts';

// -----------------------------------------------------------------------------
// `snap` — value-space discontinuity threshold. A per-sample jump beyond it is
// a TELEPORT (respawn, blink, warp): the smoothing state resets to the new
// value and every mode renders it immediately, instead of gliding across the
// map. Below the threshold, smoothing behaves exactly as before. Time-free by
// design: latency shifts when samples arrive, not what they carry, so bursty
// delivery can't false-trigger it.
// -----------------------------------------------------------------------------

const Unit = schema({ x: t.number() }, 'SnapUnit');
const SnapState = schema({ units: t.map(Unit) }, 'SnapState');

function setup(x0 = 10) {
    const server = new SnapState();
    server.units.set('a', Object.assign(new Unit(), { x: x0 }));
    const encoder = new Encoder(server);
    const decoder = new Decoder(new SnapState());
    decoder.decode(Uint8Array.from(encoder.encodeAll()));
    const cu = () => (decoder.state as any).units.get('a');
    const patch = (x: number) => { server.units.get('a')!.x = x; decoder.decode(Uint8Array.from(encoder.encode())); };
    return { decoder, cu, patch };
}

describe('Predict `snap` (teleport threshold)', () => {
    let now = 1000;
    let nowSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        now = 1000;
        nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    });
    afterEach(() => nowSpy.mockRestore());

    test('damped: a jump beyond the threshold renders immediately', () => {
        const { decoder, cu, patch } = setup();
        const p = Predict.get(decoder, { mode: 'damped', name: 'snap-damped' });
        // fields-array config — the demos' shape; `snap` rides the group profile.
        p.attachAll('units', { fields: ['x'], snap: 4 });

        now = 1050; patch(60);                    // respawn-sized jump (50 ≫ 4)
        now = 1060; p.tick(1060);
        assert.approximately(p.value(cu(), 'x'), 60, 1e-9, 'teleport snapped, no glide');
    });

    test('damped: without snap the same jump glides (control)', () => {
        const { decoder, cu, patch } = setup();
        const p = Predict.get(decoder, { mode: 'damped', name: 'snap-damped-off' });
        p.attachAll('units', { fields: ['x'] });  // no snap

        now = 1050; patch(60);
        now = 1100; p.tick(1100);                 // 50ms after the jump
        const v = p.value(cu(), 'x');
        assert.isAbove(v, 10, 'moving toward the target');
        assert.isBelow(v, 55, 'still mid-glide — damped chases, never jumps');
    });

    test('damped: a below-threshold delta still smooths', () => {
        const { decoder, cu, patch } = setup();
        const p = Predict.get(decoder, { mode: 'damped', name: 'snap-damped-small' });
        p.attachAll('units', { fields: ['x'], snap: 4 });

        now = 1050; patch(12);                    // 2 < 4 — ordinary motion
        now = 1060; p.tick(1060);
        const v = p.value(cu(), 'x');
        assert.isAbove(v, 10, 'moving');
        assert.isBelow(v, 11.9, 'NOT snapped — still gliding toward 12');
    });

    test('lerp: teleport after a delta-idle gap snaps (the respawn shape)', () => {
        // A dead entity goes delta-idle (no samples), then one sample carries the
        // fountain position. Without snap, the gap-collapse resumes over one
        // interval — a full-speed streak. With snap the ring resets: no streak.
        const { decoder, cu, patch } = setup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100, name: 'snap-lerp' });
        p.attachAll('units', { fields: ['x'], snap: 4 });

        now = 1050; patch(10.2);                  // establish cadence (~50ms)
        now = 3000; patch(60);                    // long idle, then teleport
        now = 3060; p.tick(3060);                 // target 2960 — inside the streak window without snap
        assert.approximately(p.value(cu(), 'x'), 60, 1e-9, 'ring reset — renders the teleport immediately');
    });

    test('lerp: same shape without snap streaks across the gap (control)', () => {
        const { decoder, cu, patch } = setup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100, name: 'snap-lerp-off' });
        p.attachAll('units', { fields: ['x'] });

        now = 1050; patch(10.2);
        now = 3000; patch(60);
        now = 3060; p.tick(3060);                 // target 2960: between held(2950)=10.2 and 60@3000
        const v = p.value(cu(), 'x');
        assert.isAbove(v, 10.3, 'past the held sample');
        assert.isBelow(v, 55, 'mid-streak — interpolating across the teleport');
    });

    test('reckon: a rebase jump beyond the threshold pops instead of decaying', () => {
        let serverTime = 1000;
        const clock = { serverNow: () => serverTime, rtt: () => 0, smoothedRtt: () => 0, lastServerTime: () => serverTime, sample() {} };
        const { decoder, cu, patch } = setup();
        const step = () => {};                    // stationary — forward sim = snapshot
        const p = Predict.get(decoder, { mode: 'reckon', step, smoothing: 20, snap: 4, name: 'snap-reckon', clock });
        p.attachAll('units', { fields: ['x'] });

        p.tick(1000);
        assert.approximately(p.value(cu(), 'x'), 10, 1e-9, 'seeded at the first snapshot');

        serverTime = 1100; patch(60);             // teleport rebase
        now = 1110; p.tick(1110);
        assert.approximately(p.value(cu(), 'x'), 60, 1e-9, 'discontinuity above snap → offset skipped (pop)');
    });

    test('reckon: a small rebase still decays out (control)', () => {
        let serverTime = 1000;
        const clock = { serverNow: () => serverTime, rtt: () => 0, smoothedRtt: () => 0, lastServerTime: () => serverTime, sample() {} };
        const { decoder, cu, patch } = setup();
        const step = () => {};
        const p = Predict.get(decoder, { mode: 'reckon', step, smoothing: 20, snap: 4, name: 'snap-reckon-small', clock });
        p.attachAll('units', { fields: ['x'] });

        p.tick(1000);
        p.value(cu(), 'x');

        serverTime = 1100; patch(12);             // 2 < 4 — a real misprediction, absorb it
        now = 1110; p.tick(1110);
        const v = p.value(cu(), 'x');
        assert.isAbove(v, 10, 'moving toward the rebased value');
        assert.isBelow(v, 11.9, 'offset captured — decaying, not popped');
    });
});
