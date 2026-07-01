import './util';
import { describe, test } from 'vitest';
import { assert } from 'chai';

import { Reconciler } from '../src/predict.ts';
import { SimReconciler } from '../src/predict.ts';
import type { InputHandle } from '../src/input/InputHandle.ts';

// -----------------------------------------------------------------------------
// Sub-stepping (TODO 07): one input drives N physics sub-steps of dt/N, so the
// physics rate is tickRate*N while the input/network rate stays tickRate. These
// tests pin the two halves of the contract:
//   1. the step context carries subSteps/subDt (defaulted off the input handle's
//      server-advertised values, exactly like stepSeconds), and
//   2. the replay invariant survives sub-stepping — reconcile+replay reproduces
//      the live sub-stepped trajectory bit-for-bit (no backward drift).
// -----------------------------------------------------------------------------

interface Cmd { ax: number; }

// Mirrors the handle surface the reconcilers read: rates + send/ack/replay ring.
class FakeInput {
    data: Cmd = { ax: 0 };
    stepMs?: number;
    stepSeconds?: number;
    patchRate?: number;
    subSteps?: number;
    lastProcessed = 0;
    sentCount = 0;
    private buffer = new Map<number, Cmd>();
    private sendCb?: (seq: number) => void;

    constructor(opts: { stepMs?: number; stepSeconds?: number; subSteps?: number } = {}) {
        // dt = 1s keeps the math integer-friendly; 30 Hz wire / 60 Hz physics is
        // exercised via subSteps=2 (the ratio is what matters, not the Hz).
        this.stepMs = opts.stepMs ?? 1000;
        this.stepSeconds = opts.stepSeconds ?? 1;
        this.subSteps = opts.subSteps;
    }

    send(): number {
        this.sentCount++;
        this.buffer.set(this.sentCount, { ...this.data });
        this.sendCb?.(this.sentCount);                     // notify the observing controller
        return this.sentCount;
    }
    onSend(cb: (seq: number) => void): () => void { this.sendCb = cb; return () => { this.sendCb = undefined; }; }
    at(seq: number): Cmd | undefined { return this.buffer.get(seq); }
    reckonTimeAt(_seq: number): number { return 0; } // no reckon lag-comp in tests
    get pendingCount(): number { return this.sentCount - this.lastProcessed; }
}

function asHandle(input: FakeInput): InputHandle<Cmd> {
    return input as unknown as InputHandle<Cmd>;
}

interface Self { x: number; vx: number; }

// The shared deterministic step: apply the input ONCE (impulse-safe), then
// integrate subSteps engine sub-steps of subDt — the documented recipe. The
// sub-stepped trajectory genuinely differs from a single full step (semi-
// implicit Euler is dt-sensitive), which is what makes drift detectable.
function subSteppedStep(ctx: { subSteps: number; subDt: number }, state: Self, cmd: Cmd): void {
    state.vx += cmd.ax;                      // per-INPUT effect, not per-sub-step
    for (let i = 0; i < ctx.subSteps; i++) { // per-sub-step integration
        state.vx *= 0.9;                     // damping accumulates per sub-step
        state.x += state.vx * ctx.subDt;
    }
}

// Observer-model drive helpers: mutate + send through the handle. The controller
// observes the send (via `onSend`) and steps it — reads are pure.
function stepR(_ctl: Reconciler<Self, Cmd>, input: FakeInput, cmd: Cmd): void {
    Object.assign(input.data, cmd); input.send();
}
function stepS(_ctl: SimReconciler<Cmd, { x: number }, any>, input: FakeInput, cmd: Cmd): void {
    Object.assign(input.data, cmd); input.send();
}

describe('sub-stepping (network rate ÷ physics rate decoupling)', () => {
    test('Reconciler: ctx carries subSteps/subDt defaulted from the input handle', () => {
        const input = new FakeInput({ subSteps: 2 });
        let seen: { dt: number; subSteps: number; subDt: number; subDtMs: number } | undefined;
        const ctl = new Reconciler<Self, Cmd>({ x: 0, vx: 0 }, {
            input: asHandle(input),
            step: (ctx) => { seen = { dt: ctx.dt, subSteps: ctx.subSteps, subDt: ctx.subDt, subDtMs: ctx.subDtMs }; },
            fields: ['x', 'vx'],
        });
        stepR(ctl, input, { ax: 1 });
        assert.deepEqual(seen, { dt: 1, subSteps: 2, subDt: 0.5, subDtMs: 500 });
    });

    test('Reconciler: explicit opts.subSteps overrides the handle; defaults to 1', () => {
        const sawSubSteps: number[] = [];
        const inputA = new FakeInput({ subSteps: 2 });
        const ctl = new Reconciler<Self, Cmd>({ x: 0, vx: 0 }, {
            input: asHandle(inputA),
            step: (ctx) => { sawSubSteps.push(ctx.subSteps); },
            fields: ['x', 'vx'],
            subSteps: 4,
        });
        stepR(ctl, inputA, { ax: 1 });

        const inputB = new FakeInput();
        const plain = new Reconciler<Self, Cmd>({ x: 0, vx: 0 }, {
            input: asHandle(inputB),
            step: (ctx) => { sawSubSteps.push(ctx.subSteps); assert.equal(ctx.subDt, ctx.dt); },
            fields: ['x', 'vx'],
        });
        stepR(plain, inputB, { ax: 1 });

        assert.deepEqual(sawSubSteps, [4, 1]);
    });

    test('Reconciler: reconcile+replay reproduces the live sub-stepped trajectory (no drift)', () => {
        // Live reference run, recording authoritative state after each input.
        const refInput = new FakeInput({ subSteps: 2 });
        const ref = new Reconciler<Self, Cmd>({ x: 0, vx: 0 }, {
            input: asHandle(refInput),
            step: subSteppedStep,
            fields: ['x', 'vx'],
        });
        const states: Self[] = [];
        for (let i = 0; i < 6; i++) { stepR(ref, refInput, { ax: 1 }); states.push({ ...ref.state }); }

        // Reconciling run: server acks seq 2 with its authoritative state → the
        // reconciler rewinds and replays seqs 3..6 (each = 2 sub-steps).
        const input = new FakeInput({ subSteps: 2 });
        const instance: Self = { x: 0, vx: 0 };
        const ctl = new Reconciler<Self, Cmd>(instance, {
            input: asHandle(input),
            step: subSteppedStep,
            fields: ['x', 'vx'],
            smoothing: 0,
        });
        for (let i = 0; i < 6; i++) stepR(ctl, input, { ax: 1 });
        instance.x = states[1].x; instance.vx = states[1].vx;
        input.lastProcessed = 2;
        ctl.tick(0);

        assert.strictEqual(ctl.state.x, states[5].x, 'replay covers every predicted sub-step — bit-identical');
        assert.strictEqual(ctl.state.vx, states[5].vx);
    });

    test('SimReconciler: ctx carries subSteps/subDt; replay reproduces the live run', () => {
        interface Engine { x: number; vx: number; }
        // `adopt` closes over `src` (the authoritative source) — no bound instance.
        const mkOpts = (input: FakeInput, world: Engine, src: Self) => ({
            input: asHandle(input),
            world,
            step: (ctx: { subSteps: number; subDt: number }, cmd: Cmd, w: Engine) => subSteppedStep(ctx, w, cmd),
            adopt: (w: Engine) => { w.x = src.x; w.vx = src.vx; },
            pose: (w: Engine) => ({ x: w.x }),
        });

        const refEngine: Engine = { x: 0, vx: 0 };
        const refInput = new FakeInput({ subSteps: 2 });
        const ref = new SimReconciler(mkOpts(refInput, refEngine, { x: 0, vx: 0 }));
        const states: Engine[] = [];
        for (let i = 0; i < 5; i++) { stepS(ref, refInput, { ax: 1 }); states.push({ ...refEngine }); }

        const input = new FakeInput({ subSteps: 2 });
        const engine: Engine = { x: 0, vx: 0 };
        const instance: Self = { x: 0, vx: 0 };
        const ctl = new SimReconciler(mkOpts(input, engine, instance));
        for (let i = 0; i < 5; i++) stepS(ctl, input, { ax: 1 });
        instance.x = states[0].x; instance.vx = states[0].vx;
        input.lastProcessed = 1;
        ctl.tick(0);

        assert.strictEqual(ctl.world.x, states[4].x, 'sub-stepped physics replay matches the live trajectory');
        assert.strictEqual(ctl.world.vx, states[4].vx);
    });

    test('subDt is derived with the same expression on handle and ctx (no ULP drift)', () => {
        // 30 Hz wire, 2 sub-steps → 60 Hz physics: the real-world shape from the
        // brief. (1/30)/2 is NOT representable exactly, so equality here proves
        // both reads come from one derivation.
        const input = new FakeInput({ stepSeconds: 1 / 30, stepMs: 1000 / 30, subSteps: 2 });
        let subDt = NaN;
        const ctl = new Reconciler<Self, Cmd>({ x: 0, vx: 0 }, {
            input: asHandle(input),
            step: (ctx) => { subDt = ctx.subDt; },
            fields: ['x', 'vx'],
        });
        stepR(ctl, input, { ax: 0 });
        assert.strictEqual(subDt, (1 / 30) / 2);
    });
});
