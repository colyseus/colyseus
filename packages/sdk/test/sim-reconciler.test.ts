import './util';
import { describe, test } from 'vitest';
import { assert } from 'chai';

import { SimReconciler, type SimReconcilerOptions } from '../src/predict.ts';
import type { InputHandle } from '../src/input/InputHandle.ts';
import { resetDivergenceThrottle } from '../src/predict/divergence.ts';

/** Run `fn` with `console.warn` captured; returns the joined warning strings. */
function captureWarn(fn: () => void): string[] {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...args: any[]) => { warns.push(args.join(' ')); };
    try { fn(); } finally { console.warn = orig; }
    return warns;
}

/** Run `fn` with drift telemetry enabled (simulates the `@colyseus/sdk/debug`
 *  bundle being loaded), restoring the prior global afterward. */
function withDiagnostics(fn: () => void): void {
    const g = globalThis as { __colyseusDebug?: unknown };
    const prev = g.__colyseusDebug;
    g.__colyseusDebug = { publish() {} };
    try { fn(); } finally { g.__colyseusDebug = prev; }
}

// -----------------------------------------------------------------------------
// A minimal fake of the subset of InputHandle the controller touches: stage onto
// `data`, `send()` buffers a snapshot keyed by the new `sentCount`, `at(seq)`
// replays it, and `lastProcessed` is advanced by the test to simulate server acks.
// -----------------------------------------------------------------------------

interface Cmd { ax: number; }

class FakeInput {
    data: Cmd = { ax: 0 };
    stepMs?: number;
    stepSeconds?: number;
    patchRate?: number;
    lastProcessed = 0;
    sentCount = 0;
    private buffer = new Map<number, Cmd>();
    private sendCb?: (seq: number) => void;

    constructor(opts: { stepMs?: number; stepSeconds?: number; patchRate?: number } = {}) {
        this.stepMs = opts.stepMs ?? 1000;
        this.stepSeconds = opts.stepSeconds ?? 1; // dt = 1 → simple integer math
        this.patchRate = opts.patchRate;
    }

    send(): number {
        this.sentCount++;
        this.buffer.set(this.sentCount, { ...this.data }); // snapshot for replay
        this.sendCb?.(this.sentCount);                     // notify the observing reconciler
        return this.sentCount;
    }
    onSend(cb: (seq: number) => void): () => void { this.sendCb = cb; return () => { this.sendCb = undefined; }; }
    at(seq: number): Cmd | undefined { return this.buffer.get(seq); }
    reckonTimeAt(_seq: number): number { return 0; } // no reckon lag-comp in tests
    get pendingCount(): number { return this.sentCount - this.lastProcessed; }
}

// Fake engine world. `x`/`vx` are scalar (reseeded by `adopt`); `spin` is
// ENGINE-INTERNAL — never read into the pose, never seeded from the server. It's
// the canary for the documented tradeoff: non-scalar engine state is NOT rolled
// back across reconcile — only `adopt`'s scalars + replay re-derive it.
interface Engine { x: number; vx: number; spin: number; }
function makeEngine(): Engine { return { x: 0, vx: 0, spin: 0 }; }

interface Self { x: number; vx: number; }
interface Pose { x: number; }

type Opts = SimReconcilerOptions<Cmd, Pose, Engine>;

// `adopt` closes over `src` (the authoritative source) — no bound instance.
function baseOpts(input: FakeInput, world: Engine, src: Self, extra: Partial<Opts> = {}): Opts {
    return {
        input: input as unknown as InputHandle<Cmd>,
        world,
        step: (ctx, cmd, w) => { w.vx += cmd.ax * ctx.dt; w.x += w.vx * ctx.dt; w.spin += 1; },
        adopt: (w) => { w.x = src.x; w.vx = src.vx; }, // NOT spin
        pose: (w) => ({ x: w.x }),
        ...extra,
    };
}

function make(engine: Engine, input: FakeInput, extra: Partial<Opts> = {}) {
    const instance: Self = { x: 0, vx: 0 };
    const ctl = new SimReconciler<Cmd, Pose, Engine>(baseOpts(input, engine, instance, extra));
    return { ctl, instance };
}

/**
 * Emulate one LIVE input step in the observer model: mutate + send through the
 * handle. The controller observes the send (via `onSend`) and steps it — reads
 * are pure. Returns the new seq. No reconcile/decay — that's `tick(now, alpha)`.
 */
function step(_ctl: SimReconciler<Cmd, Pose, Engine>, input: FakeInput, cmd: Cmd): number {
    Object.assign(input.data, cmd);
    input.send();   // → onSend → controller steps the input
    return input.sentCount;
}

describe('SimReconciler', () => {
    test('seeds the pose from the world; no pending before any input', () => {
        const engine = makeEngine();
        engine.x = 4;
        const instance: Self = { x: 4, vx: 0 };
        const ctl = new SimReconciler<Cmd, Pose, Engine>(baseOpts(new FakeInput(), engine, instance));
        assert.equal(ctl.value('x'), 4);
        assert.equal(ctl.pendingCount, 0);
    });

    test('a sent input predicts immediately (advances the world on the next read)', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl } = make(engine, input);

        const seq = step(ctl, input, { ax: 1 }); // vx 0→1, x 0→1
        assert.equal(seq, 1);
        assert.equal(input.sentCount, 1);
        assert.equal(engine.vx, 1);
        assert.equal(engine.x, 1);
        assert.equal(ctl.pendingCount, 1);
    });

    test('engine-internal non-scalar state (spin) is not rolled back — adopt reseeds scalars only', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl, instance } = make(engine, input);

        for (let i = 0; i < 5; i++) step(ctl, input, { ax: 1 }); // → x=15, vx=5, spin=5
        instance.x = 3; instance.vx = 2; // server truth at acked tick 2
        input.lastProcessed = 2;
        ctl.tick(0); // adopt reseeds x/vx only; spin NOT rolled back

        // Scalars round-trip fine (x restored by adopt + replay)...
        assert.equal(ctl.world.x, 15);
        // ...but spin was never rolled back, so replaying seq 3,4,5 double-counts: 5 + 3 = 8.
        // This is the accepted tradeoff of having no snapshot ring (see the doc header).
        assert.equal(ctl.world.spin, 8, 'non-scalar engine state is not rolled back across reconcile');
        assert.strictEqual(ctl.world, engine, 'the world handle is never swapped');
    });

    test('deterministic replay: reconcile+replay reproduces the live scalar trajectory', () => {
        // Live reference run, recording the authoritative state after each step.
        const refEngine = makeEngine();
        const refInput = new FakeInput();
        const ref = make(refEngine, refInput);
        const states: Engine[] = [{ ...refEngine }];
        for (let i = 0; i < 4; i++) { step(ref.ctl, refInput, { ax: 2 }); states.push({ ...refEngine }); }

        // Reconciling run: ack seq 1 with the authoritative seq-1 state → replay 2,3,4.
        const engine = makeEngine();
        const input = new FakeInput();
        const { ctl, instance } = make(engine, input);
        for (let i = 0; i < 4; i++) step(ctl, input, { ax: 2 });
        instance.x = states[1].x; instance.vx = states[1].vx;
        input.lastProcessed = 1;
        ctl.tick(0);

        // The SCALARS that `adopt` reseeds + replay re-derives match the live run.
        // (`spin` does not — it's engine-internal and not rolled back; see above.)
        assert.deepEqual(
            { x: ctl.world.x, vx: ctl.world.vx },
            { x: states[4].x, vx: states[4].vx },
            'reconcile+replay yields the same scalar state as the live run',
        );
    });

    test('correct prediction induces no correction (render undisturbed by reconcile)', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl, instance } = make(engine, input, { smoothing: 10 });
        for (let i = 0; i < 3; i++) step(ctl, input, { ax: 1 });
        ctl.tick(0);         // prime the render clock (first tick has dt 0)
        ctl.tick(500);       // dt 500 → interpolation fraction 0.5 (no ack yet → no reconcile)
        const before = ctl.value('x');
        instance.x = engine.x; instance.vx = engine.vx; // exact agreement (all acked)
        input.lastProcessed = 3;
        ctl.tick(500);       // same render clock (dt 0); reconcile(3) matched → ~zero error
        const after = ctl.value('x');
        assert.approximately(after, before, 1e-9, 'a correct prediction leaves the rendered pose untouched');
    });

    test('mispredict is smoothed (hidden then decayed), not popped', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl, instance } = make(engine, input, { smoothing: 10 });

        for (let i = 0; i < 3; i++) step(ctl, input, { ax: 0 }); // engine stays at x=0
        instance.x = 10; instance.vx = 0; // big server correction
        input.lastProcessed = 3;
        ctl.tick(0); // reconcile(3): curPose.x=10, error.x=-10 (smoothed value stays 0); render clock at 0 → alpha 0
        let v = ctl.value('x');
        assert.approximately(v, 0, 1e-9, 'correction hidden at reconcile instant, not popped to 10');

        // Decay: value monotonically eases toward the server truth. Stepping is
        // paused (no more sends), so the interpolation fraction also eases to 1 and
        // HOLDS — the render settles at the latest step (cur = 10), not a frozen
        // mid-interpolation. Both the error decay and alpha→1 move value 0 → 10.
        let prev = v;
        for (let now = 100; now <= 4000; now += 100) {
            ctl.tick(now);
            v = ctl.value('x');
            assert.isAtLeast(v, prev - 1e-9, 'monotonic decay, never overshoots backward');
            prev = v;
        }
        assert.approximately(v, 10, 0.3, 'error decayed to ~0 AND interpolation held at cur → value converges to the server truth');
    });

    test('custom interpolate is used by value()/pose()', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        let called = false;
        const { ctl } = make(engine, input, { interpolate: () => { called = true; return { x: 999 }; } });
        step(ctl, input, { ax: 1 });
        assert.equal(ctl.value('x'), 999, 'value() routes through the custom interpolate');
        assert.isTrue(called);
        assert.deepEqual(ctl.pose(), { x: 999 });
    });

    test('reset() forgets in-flight inputs so they are not replayed', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl, instance } = make(engine, input);
        for (let i = 0; i < 3; i++) step(ctl, input, { ax: 1 });

        instance.x = 0; instance.vx = 0; // respawn at origin
        ctl.reset();
        assert.equal(ctl.world.x, 0);
        assert.equal(ctl.world.vx, 0);

        // A late ack for a pre-reset seq must not replay the old life.
        input.lastProcessed = 2;
        ctl.tick(0);
        assert.equal(ctl.world.x, 0, 'pre-reset inputs are not replayed after reset');
    });

    test('drift: a clean reconcile (prediction matched) leaves drift ~0 but bumps reconcileSeq', () => withDiagnostics(() => {
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl, instance } = make(engine, input);
        for (let i = 0; i < 3; i++) step(ctl, input, { ax: 1 });   // predicted x: 1, 3, 6
        // Server agrees at seq 1 (x=1, vx=1); replaying 2,3 reproduces x=6 → zero correction.
        instance.x = 1; instance.vx = 1;
        input.lastProcessed = 1;
        ctl.tick(0);
        assert.equal(ctl.reconcileSeq, 1);
        assert.equal(ctl.lastCorrectionMag, 0);
        assert.equal(ctl.drift.ema, 0);
        assert.equal(ctl.drift.peak, 0);
    }));

    test('drift: a mispredict raises lastCorrectionMag, the EMA, and the peak', () => withDiagnostics(() => {
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl, instance } = make(engine, input);
        for (let i = 0; i < 3; i++) step(ctl, input, { ax: 1 });   // predicted x: 1, 3, 6
        // Server DISAGREES at seq 1 (x=10 vs predicted 1); replay 2,3 → x=15.
        instance.x = 10; instance.vx = 1;
        input.lastProcessed = 1;
        ctl.tick(0);
        assert.equal(ctl.lastCorrectionMag, 9, 'rendered-before 6 vs reconciled 15');
        assert.closeTo(ctl.drift.ema, 0.9, 1e-9, 'EMA = 0 + (9-0)*0.1');
        assert.equal(ctl.drift.peak, 9, 'peak tracks the spike');
        ctl.reset();
        assert.equal(ctl.drift.ema, 0, 'reset clears drift for the new life');
        assert.equal(ctl.drift.peak, 0);
    }));

    test('drift: telemetry is NOT computed by default (no warnOnDivergence, no debug bundle)', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl, instance } = make(engine, input);     // production default — nothing watching
        for (let i = 0; i < 3; i++) step(ctl, input, { ax: 1 });
        instance.x = 10; instance.vx = 1;                  // a real mispredict…
        input.lastProcessed = 1;
        ctl.tick(0);
        assert.equal(ctl.lastCorrectionMag, 0, '…but telemetry stays zero — nobody is watching');
        assert.equal(ctl.drift.ema, 0);
        // The reconciliation itself still happened (error rebase is unconditional).
        assert.equal(ctl.world.x, 15, 'reconcile still ran — only the telemetry was skipped');
    });

    test('divergence: warns once, naming the seq and worst field, when correction exceeds tolerance', () => {
        resetDivergenceThrottle();
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl, instance } = make(engine, input, { warnOnDivergence: 0.5 });
        for (let i = 0; i < 3; i++) step(ctl, input, { ax: 1 });   // predicted x: 1, 3, 6
        instance.x = 10; instance.vx = 1;                   // mispredict at seq 1 → x=15
        input.lastProcessed = 1;
        const warns = captureWarn(() => ctl.tick(0));
        assert.equal(warns.length, 1);
        assert.include(warns[0], 'seq 1');
        assert.include(warns[0], '"x"');
        assert.include(warns[0], '-9.000');
    });

    test('divergence: silent when the correction is within tolerance', () => {
        resetDivergenceThrottle();
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl, instance } = make(engine, input, { warnOnDivergence: 20 }); // 20 > mag 9
        for (let i = 0; i < 3; i++) step(ctl, input, { ax: 1 });
        instance.x = 10; instance.vx = 1;
        input.lastProcessed = 1;
        assert.equal(captureWarn(() => ctl.tick(0)).length, 0);
    });

    test('divergence: silent when warnOnDivergence is unset (opt-in)', () => {
        resetDivergenceThrottle();
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl, instance } = make(engine, input);   // no warnOnDivergence
        for (let i = 0; i < 3; i++) step(ctl, input, { ax: 1 });
        instance.x = 10; instance.vx = 1;
        input.lastProcessed = 1;
        assert.equal(captureWarn(() => ctl.tick(0)).length, 0);
    });

    test('divergence: rapid repeats are throttled to one warning', () => {
        resetDivergenceThrottle();
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl, instance } = make(engine, input, { warnOnDivergence: 0.5 });
        const warns = captureWarn(() => {
            for (let i = 0; i < 3; i++) step(ctl, input, { ax: 1 });
            instance.x = 10; input.lastProcessed = 1; ctl.tick(0);   // warns
            for (let i = 0; i < 3; i++) step(ctl, input, { ax: 1 });
            instance.x = 50; input.lastProcessed = 4; ctl.tick(0);   // throttled (within 1s)
        });
        assert.equal(warns.length, 1, 'the second divergence within 1s is throttled');
    });

    // ctx.record: run-once-on-live, replay-the-memo, cleared on reset. The compute
    // returns a value that would DIFFER if recomputed (a climbing counter), so a
    // replay that re-ran it would corrupt both the count AND the trajectory — making
    // "compute is not re-run" assertable from outside.
    test('ctx.record runs compute once on the live step and replays the frozen value (never recomputes)', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        let computeCount = 0;
        // ax=0 → the base sim leaves x alone; ctx.record is the only thing moving x.
        const { ctl, instance } = make(engine, input, {
            step: (ctx, _cmd, w) => {
                const v = ctx.record('bump', () => { computeCount++; return computeCount * 100; });
                w.x += v ?? 0;
            },
        });

        for (let i = 0; i < 3; i++) step(ctl, input, { ax: 0 }); // memos: seq1=100, seq2=200, seq3=300
        assert.equal(computeCount, 3, 'compute ran exactly once per live step');
        assert.equal(engine.x, 600, '100 + 200 + 300');

        // Ack seq 1 at its authoritative post-step state (x=100) → adopt + replay 2,3.
        instance.x = 100; instance.vx = 0;
        input.lastProcessed = 1;
        ctl.tick(0);

        assert.equal(computeCount, 3, 'replay returned the memo — compute was NOT re-run');
        assert.equal(engine.x, 600, 'frozen 200 + 300 re-applied on top of adopted 100');
    });

    test('ctx.record memos are cleared on reset (a prior life\'s effect never replays)', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        let computeCount = 0;
        const { ctl, instance } = make(engine, input, {
            step: (ctx, _cmd, w) => { w.x += ctx.record('bump', () => { computeCount++; return 100; }) ?? 0; },
        });

        for (let i = 0; i < 3; i++) step(ctl, input, { ax: 0 }); // 3 unacked values recorded
        assert.equal(computeCount, 3);

        instance.x = 0; instance.vx = 0; // respawn at origin
        ctl.reset();
        assert.equal(engine.x, 0, 'reset adopts origin');

        // A late ack for a pre-reset seq must not replay the old life's effects.
        input.lastProcessed = 2;
        ctl.tick(0);
        assert.equal(engine.x, 0, 'cleared records are not replayed after reset');
        assert.equal(computeCount, 3, 'no recompute either');
    });
});

// -----------------------------------------------------------------------------
// Frame-order (read-before-pump) warning: a render read between tick() and the
// frame's sends is one step stale — the controller warns once when the sends
// then arrive after such a read. Correct wiring, pauses, and controller-driven
// reads must all stay silent.
// -----------------------------------------------------------------------------

describe('read-before-pump warning', () => {
    test('warns once when a render value is read between tick() and the frame\'s sends', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl } = make(engine, input);

        ctl.tick(0);                    // prime (dt 0)
        step(ctl, input, { ax: 1 });    // frame 0: correct order

        const warns = captureWarn(() => {
            ctl.tick(1000);             // a full step is due
            ctl.value('x');             // ← read BEFORE the frame's send (the bug)
            step(ctl, input, { ax: 1 }); // pump lands after the read → warn
            // same pattern again — once per controller, stays silent
            ctl.tick(2000);
            ctl.value('x');
            step(ctl, input, { ax: 1 });
        });
        assert.lengthOf(warns.filter(w => w.includes('read BEFORE')), 1);
    });

    test('silent when the frame sends before reading (correct order)', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl } = make(engine, input);

        const warns = captureWarn(() => {
            ctl.tick(0);
            for (let f = 1; f <= 5; f++) {
                ctl.tick(f * 1000);
                step(ctl, input, { ax: 1 }); // pump first
                ctl.value('x');              // read after
                ctl.pose();
            }
        });
        assert.lengthOf(warns, 0);
    });

    test('silent while stepping is paused (reads hold at clamped alpha, no sends)', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl } = make(engine, input);

        const warns = captureWarn(() => {
            ctl.tick(0);
            step(ctl, input, { ax: 1 });
            // menu/death: ticks + reads continue, inputs are gated off
            for (let f = 1; f <= 5; f++) { ctl.tick(f * 1000); ctl.value('x'); }
            // resume in correct order — the armed read belongs to an old frame
            ctl.tick(6000);
            step(ctl, input, { ax: 1 });
            ctl.value('x');
        });
        assert.lengthOf(warns, 0);
    });

    test('reads from inside a step callback never arm the warning (live or replay)', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        const instance: Self = { x: 0, vx: 0 };
        // step reads back a render value — controller-driven, not the app's render pass
        let ctl!: SimReconciler<Cmd, Pose, Engine>;
        ctl = new SimReconciler<Cmd, Pose, Engine>(baseOpts(input, engine, instance, {
            step: (ctx, cmd, w) => { w.vx += cmd.ax * ctx.dt; w.x += w.vx * ctx.dt; ctl.value('x'); },
        }));

        const warns = captureWarn(() => {
            ctl.tick(0);
            step(ctl, input, { ax: 1 });    // live catch-up: step reads value()
            ctl.tick(1000);
            step(ctl, input, { ax: 1 });
            // ack seq 1 → next tick reconciles → REPLAY of seq 2 reads value()
            input.lastProcessed = 1;
            instance.x = 1; instance.vx = 1;
            ctl.tick(2000);
            step(ctl, input, { ax: 1 });    // pump after the reconcile — must not warn
            ctl.value('x');
        });
        assert.lengthOf(warns, 0);
    });
});
