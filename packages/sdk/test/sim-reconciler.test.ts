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

    constructor(opts: { stepMs?: number; stepSeconds?: number; patchRate?: number } = {}) {
        this.stepMs = opts.stepMs ?? 1000;
        this.stepSeconds = opts.stepSeconds ?? 1; // dt = 1 → simple integer math
        this.patchRate = opts.patchRate;
    }

    send(): void {
        this.sentCount++;
        this.buffer.set(this.sentCount, { ...this.data }); // snapshot for replay
    }
    at(seq: number): Cmd | undefined { return this.buffer.get(seq); }
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

describe('SimReconciler', () => {
    test('seeds the pose from the world; no pending before any input', () => {
        const engine = makeEngine();
        engine.x = 4;
        const instance: Self = { x: 4, vx: 0 };
        const ctl = new SimReconciler<Cmd, Pose, Engine>(baseOpts(new FakeInput(), engine, instance));
        ctl.beginFrame(0);
        assert.equal(ctl.value('x'), 4);
        assert.equal(ctl.pendingCount, 0);
    });

    test('input() predicts immediately, transmits, and advances the world', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl } = make(engine, input);

        const seq = ctl.input({ ax: 1 }); // vx 0→1, x 0→1
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

        for (let i = 0; i < 5; i++) ctl.input({ ax: 1 }); // → x=15, vx=5, spin=5
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
        const ref = make(refEngine, new FakeInput());
        const states: Engine[] = [{ ...refEngine }];
        for (let i = 0; i < 4; i++) { ref.ctl.input({ ax: 2 }); states.push({ ...refEngine }); }

        // Reconciling run: ack seq 1 with the authoritative seq-1 state → replay 2,3,4.
        const engine = makeEngine();
        const input = new FakeInput();
        const { ctl, instance } = make(engine, input);
        for (let i = 0; i < 4; i++) ctl.input({ ax: 2 });
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
        for (let i = 0; i < 3; i++) ctl.input({ ax: 1 });
        instance.x = engine.x; instance.vx = engine.vx; // exact agreement (all acked)
        input.lastProcessed = 3;

        ctl.beginFrame(500); // alpha = 0.5
        const before = ctl.value('x');
        ctl.tick(0);         // reconcile(3): prediction matched → ~zero error
        const after = ctl.value('x');
        assert.approximately(after, before, 1e-9, 'a correct prediction leaves the rendered pose untouched');
    });

    test('mispredict is smoothed (hidden then decayed), not popped', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl, instance } = make(engine, input, { smoothing: 10 });

        for (let i = 0; i < 3; i++) ctl.input({ ax: 0 }); // engine stays at x=0
        instance.x = 10; instance.vx = 0; // big server correction
        input.lastProcessed = 3;
        ctl.tick(0); // reconcile(3): curPose.x=10, error.x=-10 (smoothed value stays 0)

        ctl.beginFrame(500); // alpha = 0.5 (no steps)
        let v = ctl.value('x');
        assert.approximately(v, 0, 1e-9, 'correction hidden at reconcile instant, not popped to 10');

        // Decay: value monotonically eases toward the smoothed target (prev=0 + cur*alpha = 5).
        let prev = v;
        for (let now = 100; now <= 4000; now += 100) {
            ctl.tick(now);
            v = ctl.value('x');
            assert.isAtLeast(v, prev - 1e-9, 'monotonic decay, never overshoots backward');
            prev = v;
        }
        assert.approximately(v, 5, 0.3, 'error decayed to ~0 → value converges to prev + cur*alpha');
    });

    test('custom interpolate is used by value()/pose()', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        let called = false;
        const { ctl } = make(engine, input, { interpolate: () => { called = true; return { x: 999 }; } });
        ctl.input({ ax: 1 });
        ctl.beginFrame(500);
        assert.equal(ctl.value('x'), 999, 'value() routes through the custom interpolate');
        assert.isTrue(called);
        assert.deepEqual(ctl.pose(), { x: 999 });
    });

    test('reset() forgets in-flight inputs so they are not replayed', () => {
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl, instance } = make(engine, input);
        for (let i = 0; i < 3; i++) ctl.input({ ax: 1 });

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
        for (let i = 0; i < 3; i++) ctl.input({ ax: 1 });   // predicted x: 1, 3, 6
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
        for (let i = 0; i < 3; i++) ctl.input({ ax: 1 });   // predicted x: 1, 3, 6
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
        for (let i = 0; i < 3; i++) ctl.input({ ax: 1 });
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
        for (let i = 0; i < 3; i++) ctl.input({ ax: 1 });   // predicted x: 1, 3, 6
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
        for (let i = 0; i < 3; i++) ctl.input({ ax: 1 });
        instance.x = 10; instance.vx = 1;
        input.lastProcessed = 1;
        assert.equal(captureWarn(() => ctl.tick(0)).length, 0);
    });

    test('divergence: silent when warnOnDivergence is unset (opt-in)', () => {
        resetDivergenceThrottle();
        const input = new FakeInput();
        const engine = makeEngine();
        const { ctl, instance } = make(engine, input);   // no warnOnDivergence
        for (let i = 0; i < 3; i++) ctl.input({ ax: 1 });
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
            for (let i = 0; i < 3; i++) ctl.input({ ax: 1 });
            instance.x = 10; input.lastProcessed = 1; ctl.tick(0);   // warns
            for (let i = 0; i < 3; i++) ctl.input({ ax: 1 });
            instance.x = 50; input.lastProcessed = 4; ctl.tick(0);   // throttled (within 1s)
        });
        assert.equal(warns.length, 1, 'the second divergence within 1s is throttled');
    });
});
