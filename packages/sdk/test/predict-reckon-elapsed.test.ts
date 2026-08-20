import './util';
import { describe, test } from 'vitest';
import { assert } from 'chai';

import { schema, t, Encoder, Decoder } from '@colyseus/schema';
import { Predict } from '../src/predict.ts';

// -----------------------------------------------------------------------------
// Reckon advance: absolute-time threading.
//
// The advance scratch starts from the SNAPSHOT state (age `fwd` ago), so the
// substep loop must thread `elapsedMs` from `elapsedMs() − fwd` up to exactly
// `elapsedMs()` — the displayed instant of TIME-SAMPLED fields (sinusoids,
// cooldown snaps) then equals the instant the input prefix stamps (reckonTime
// = serverNow), and the server's lag-comp read cancels clock-estimate error.
//
// Regression: the loop used to START at `elapsedMs()` and climb to
// `elapsedMs() + fwd`, displaying time-sampled fields one snapshot-age
// (~one-way latency) in the future — a latency-scaled client/server verdict
// desync, invisible on integrated fields (x += vx·dt) and so on patrol-style
// movers, fatal on absolute-sine movers (the platformer's jumper bob).
// -----------------------------------------------------------------------------

const Bobber = schema({
    x: t.number(),
    y: t.number(),
    vx: t.number(),
}, "ElapsedBobber");

const BobState = schema({
    enemies: t.map(Bobber),
}, "ElapsedBobState");

// serverNow − lastServerTime = 100ms snapshot age → reckon forwards by 100ms.
const clock = { serverNow: () => 1100, rtt: () => 100, smoothedRtt: () => 100, lastServerTime: () => 1000, sample() {} };

function decodeOne() {
    const server = new BobState();
    server.enemies.set('a', Object.assign(new Bobber(), { x: 10, y: 0, vx: 2 }));
    const client = new BobState();
    const decoder = new Decoder(client);
    decoder.decode(Uint8Array.from(new Encoder(server).encodeAll()));
    return decoder;
}

describe('reckon advance: absolute-time threading', () => {
    test('time-sampled fields display at exactly elapsedMs() — not elapsedMs() + age', () => {
        const decoder = decodeOne();
        const seen: number[] = [];
        // `y` samples absolute time directly — any elapsed-base error shows up
        // verbatim in the displayed value. `x` integrates as a control.
        const step = (s: { x: number; y: number; vx: number }, dt: number, elapsedMs: number) => {
            s.x += s.vx * dt;
            s.y = elapsedMs;
            seen.push(elapsedMs);
        };
        const p = Predict.get(decoder, { mode: 'reckon', step, smoothMs: 0, name: 'elapsed', clock });
        p.attachAll('enemies', { fields: ['x', 'y', 'vx'] } as any);
        const ce = (decoder.state as any).enemies.get('a');
        p.tick(0);

        // Final substep lands exactly on serverNow (= the reckonTime stamp).
        assert.equal(p.value(ce, 'y'), 1100, 'sampled-time display instant must equal serverNow');
        // Substeps run forward from the snapshot instant, never before it.
        assert.isAbove(Math.min(...seen), 1000, 'elapsed starts just after the snapshot instant');
        assert.equal(Math.max(...seen), 1100, 'elapsed ends at serverNow');
        // Integrated control: forwarded by exactly the 100ms age.
        assert.approximately(p.value(ce, 'x'), 10.2, 1e-6);
    });
});
