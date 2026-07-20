import './util';
import { describe, test } from 'vitest';
import { assert } from 'chai';

import { Reconciler, SimReconciler } from '../src/predict.ts';

// -----------------------------------------------------------------------------
// DX ergonomics of the shared rollback controller:
//   #1  a wrong/unknown fixed step silently diverges rollback-replay, so the
//       controller THROWS when it can't be determined (no 60Hz fallback).
//   #2  single input surface: you mutate + send through the HANDLE directly
//       (`input.data.x = …; input.send()`); the controller is a pure observer —
//       it subscribes to the handle's `onSend` and steps each sent input right
//       then, so reads stay pure. No `input()`/`data`/`writeInput` on the reconciler.
// -----------------------------------------------------------------------------

interface Cmd { q: number; }

class MutData { q = 0; }

/** Minimal input handle. `rate` controls what the handle advertises so we can
 *  exercise the unknown-fixed-step guard. */
class FakeInput {
    data = new MutData();
    stepMs: number | undefined;
    stepSeconds: number | undefined;
    subSteps = 1;
    patchRate = 1000;
    lastProcessed = 0;
    sentCount = 0;
    private buffer = new Map<number, Cmd>();
    private sendCb?: (seq: number) => void;

    constructor(rate: { stepMs?: number; stepSeconds?: number } = { stepMs: 1000, stepSeconds: 1 }) {
        this.stepMs = rate.stepMs;
        this.stepSeconds = rate.stepSeconds;
    }
    send(): number {
        this.sentCount++;
        this.buffer.set(this.sentCount, { q: this.data.q }); // snapshot the staged value
        this.sendCb?.(this.sentCount);                        // notify the observing reconciler
        return this.sentCount;
    }
    onSend(cb: (seq: number) => void): () => void { this.sendCb = cb; return () => { this.sendCb = undefined; }; }
    at(seq: number): Cmd | undefined { return this.buffer.get(seq); }
    reckonTimeAt(_seq: number): number { return 0; }
    get pendingCount(): number { return this.sentCount - this.lastProcessed; }
}

describe('#1 unknown fixed step guard', () => {
    test('throws when neither the handle nor opts advertise a fixed step', () => {
        const input = new FakeInput({}); // no stepMs / stepSeconds advertised
        assert.throws(
            () => new Reconciler<{ x: number }, Cmd>({ x: 0 }, {
                input: input as any,
                fields: ['x'],
                step: (_c, s, cmd) => { s.x += cmd.q; },
            }),
            /fixed simulation step is unknown/,
        );
    });

    test('an explicit stepMs opt satisfies the guard even with a bare handle', () => {
        const input = new FakeInput({}); // handle advertises nothing
        assert.doesNotThrow(() => new Reconciler<{ x: number }, Cmd>({ x: 0 }, {
            input: input as any,
            fields: ['x'],
            stepMs: 1000 / 60,
            step: (_c, s, cmd) => { s.x += cmd.q; },
        }));
    });

    test('SimReconciler enforces the same guard', () => {
        const input = new FakeInput({});
        assert.throws(
            () => new SimReconciler<Cmd, { x: number }, { x: number }>({
                input: input as any,
                world: { x: 0 },
                step: (_c, w, cmd) => { w.x += cmd.q; },
                adopt: () => {},
                pose: (w) => ({ x: w.x }),
            }),
            /fixed simulation step is unknown/,
        );
    });
});

describe('#2 the reconciler observes the input handle (single mutate + send surface)', () => {
    test('Reconciler predicts each input sent through the handle (stepped on send)', () => {
        const input = new FakeInput();
        const recon = new Reconciler<{ x: number }, Cmd>({ x: 0 }, {
            input: input as any,
            fields: ['x'],
            smoothing: 0,
            step: (_c, s, cmd) => { s.x += cmd.q; },
        });

        input.data.q = 3; input.send();   // the ONE way to mutate + send (stepped now)
        input.data.q = 4; input.send();

        assert.strictEqual(recon.state.x, 7, 'each send stepped the reconciler; state is a pure read');
        // The buffered snapshots reflect each send (so replay reproduces them).
        assert.strictEqual(input.at(1)!.q, 3);
        assert.strictEqual(input.at(2)!.q, 4);
    });

    test('value() is a pure read; interpolation eases toward the latest step over time', () => {
        const input = new FakeInput();   // stepMs 1000
        const recon = new Reconciler<{ x: number }, Cmd>({ x: 0 }, {
            input: input as any,
            fields: ['x'],
            smoothing: 0,
            step: (_c, s, cmd) => { s.x += cmd.q; },
        });
        input.data.q = 5; input.send();   // stepped (prev = 0, cur = 5)
        recon.tick(0);                     // prime the render clock (first tick has dt 0)
        recon.tick(1000);                  // one full step of render time elapsed → alpha eases to 1
        assert.strictEqual(recon.value('x'), 5);
    });

    test('steady stepping renders smooth, even increments (no per-frame stutter)', () => {
        // Regression: the interpolation fraction must track the exact fixed-step
        // leftover, not a frame-quantized approximation — else constant-velocity
        // motion renders in uneven jumps (the "moving forward stutters" bug). Drive
        // a constant velocity with render frames finer than the step rate and assert
        // the rendered value advances by a CONSTANT amount each frame.
        const input = new FakeInput({ stepMs: 100, stepSeconds: 0.1 });
        const recon = new Reconciler<{ x: number }, Cmd>({ x: 0 }, {
            input: input as any,
            fields: ['x'],
            smoothing: 0,
            step: (_c, s) => { s.x += 10; },   // +10 world units per step (constant velocity)
        });
        const STEP = 100, FRAME = 40;          // 2.5 render frames per step
        let pacc = 0, now = 0;
        recon.tick(0);                          // prime the render clock
        const vals: number[] = [];
        for (let f = 0; f < 25; f++) {
            now += FRAME;
            recon.tick(now);                    // advance render clock (as predict.tick would)
            pacc += FRAME;
            while (pacc >= STEP) { pacc -= STEP; input.send(); }  // send the fixed steps due
            vals.push(recon.value('x'));
        }
        // Steady render velocity = 10 units/step × (FRAME/STEP) = 4 units/frame.
        const tail = vals.slice(8);             // skip warmup (before the first step lands)
        for (let i = 1; i < tail.length; i++) {
            assert.approximately(tail[i] - tail[i - 1], 4, 1e-6, `even increment, got ${tail[i] - tail[i - 1]}`);
        }
    });

    test('a render clock lagging the pacing accumulator resyncs (load offset — no stutter)', () => {
        // Regression: the reconciler is created mid-frame, so its render clock (first
        // tick dt=0) starts a frame BEHIND the pacing accumulator — a step can be
        // applied while renderAcc hasn't reached stepMs. The FLOORED per-step consume
        // must snap it to 0 (resync); a `%=`-style reduction would leave it in a bad
        // phase → first-load stutter.
        const input = new FakeInput({ stepMs: 100, stepSeconds: 0.1 });
        const recon = new Reconciler<{ x: number }, Cmd>({ x: 0 }, {
            input: input as any,
            fields: ['x'],
            smoothing: 0,
            step: (_c, s) => { s.x += 10; },
        });
        recon.tick(0);
        recon.tick(40);   // render clock only 40ms in...
        input.send();     // ...but a step is applied (pacing accumulator was ahead) → floored to 0
        let now = 40, pacc = 0;
        const vals: number[] = [];
        for (let f = 0; f < 15; f++) {
            now += 40; recon.tick(now);
            pacc += 40; while (pacc >= 100) { pacc -= 100; input.send(); }
            vals.push(recon.value('x'));
        }
        const tail = vals.slice(4);
        for (let i = 1; i < tail.length; i++) {
            assert.approximately(tail[i] - tail[i - 1], 4, 1e-6, `smooth after load resync, got ${tail[i] - tail[i - 1]}`);
        }
    });

    test('a frame hitch (tab-in huge dt) resyncs the render clock — no step-rate pinning', () => {
        // Regression: on a tab-in frame the render clock sees a huge dt while the
        // pacing accumulator DROPS its backlog (applies only a capped number of
        // steps). If the render clock kept the dropped backlog as a whole-step lead,
        // alpha pins at 1 and the render snaps at the step rate (stutter). Assert
        // that steady motion resumes with even per-frame increments after the hitch.
        const input = new FakeInput({ stepMs: 100, stepSeconds: 0.1 });
        const recon = new Reconciler<{ x: number }, Cmd>({ x: 0 }, {
            input: input as any,
            fields: ['x'],
            smoothing: 0,
            step: (_c, s) => { s.x += 10; },
        });
        const STEP = 100, FRAME = 40, MAX = 5; // MAX = Predict's per-frame step cap
        let pacc = 0, now = 0;
        recon.tick(0);
        // Warm up steady.
        for (let f = 0; f < 10; f++) {
            now += FRAME; recon.tick(now);
            pacc += FRAME; while (pacc >= STEP) { pacc -= STEP; input.send(); }
        }
        // Tab-in HITCH: one huge frame. The pacing accumulator drops its backlog —
        // caps steps at MAX and resets — so we send MAX and zero `pacc` to match.
        now += 5000; recon.tick(now);
        for (let i = 0; i < MAX; i++) input.send();
        pacc = 0;
        // Resume steady; the increments must be even again (not step-rate jumps).
        const vals: number[] = [];
        for (let f = 0; f < 15; f++) {
            now += FRAME; recon.tick(now);
            pacc += FRAME; while (pacc >= STEP) { pacc -= STEP; input.send(); }
            vals.push(recon.value('x'));
        }
        const tail = vals.slice(4);
        for (let i = 1; i < tail.length; i++) {
            assert.approximately(tail[i] - tail[i - 1], 4, 1e-6, `smooth after hitch, got ${tail[i] - tail[i - 1]}`);
        }
    });

    test('render holds at the latest step when stepping pauses (no sawtooth)', () => {
        // Regression: if `tick` keeps running while the app stops sending (input
        // gated off on death / a menu / a freeze), the interpolation must ease to
        // the latest step and HOLD — not sawtooth back to the previous one each
        // step interval (which showed up as a camera stutter on death). alpha is
        // derived from time-since-last-step, so a stalled sim clamps it at 1.
        const input = new FakeInput();   // stepMs 1000
        const recon = new Reconciler<{ x: number }, Cmd>({ x: 0 }, {
            input: input as any,
            fields: ['x'],
            smoothing: 0,   // isolate interpolation from error decay
            step: (_c, s, cmd) => { s.x += cmd.q; },
        });
        input.data.q = 10; input.send();   // prev = 0, cur = 10; lastStepAt = render clock 0

        // Tick across MANY step intervals with NO further sends — value must be
        // monotonic up to cur and never fall back.
        let prev = -Infinity;
        for (let now = 0; now <= 5000; now += 100) {
            recon.tick(now);
            const v = recon.value('x');
            assert.isAtLeast(v, prev - 1e-9, `no backward jump at t=${now}`);
            prev = v;
        }
        assert.strictEqual(recon.value('x'), 10, 'holds at the latest step, not oscillating between prev and cur');
    });

    test('SimReconciler observes the world through the same handle sends', () => {
        const input = new FakeInput();
        const me = new SimReconciler<Cmd, { x: number }, { x: number }>({
            input: input as any,
            world: { x: 0 },
            smoothing: 0,
            step: (_c, w, cmd) => { w.x += cmd.q; },
            adopt: () => {},
            pose: (w) => ({ x: w.x }),
        });

        input.data.q = 2; input.send();
        input.data.q = 5; input.send();

        assert.strictEqual(me.world.x, 7);
    });
});
