import './util';
import { describe, test } from 'vitest';
import { assert } from 'chai';

import { schema, t, encode, decode } from '@colyseus/schema';
import { Reconciler } from '../src/predict.ts';
import { wireQuantizerOf } from '../src/core/schema-reflect.ts';
import type { InputHandle } from '../src/input/InputHandle.ts';

// -----------------------------------------------------------------------------
// Wire-precision-aware reconciliation: the reconciler compares its prediction at
// the acked seq against the decoded truth THROUGH each field's wire quantizer
// (fround for float32, the codec's dynamic rule for auto `number`, identity for
// exact types). Wire-indistinguishable ⇒ adopt+replay are skipped and the client
// keeps its full-precision state — so lossy wire types stop injecting rounding
// noise into the rollback restore point. A REAL mispredict (a difference the
// wire can express) still adopts + replays exactly as before.
// -----------------------------------------------------------------------------

interface Cmd { ax: number; }

class FakeInput {
    data: Cmd = { ax: 0 };
    stepMs = 1000;
    stepSeconds = 1;
    subSteps = 1;
    patchRate = 1000;
    lastProcessed = 0;
    sentCount = 0;
    private buffer = new Map<number, Cmd>();
    private sendCb?: (seq: number) => void;

    send(): number {
        this.sentCount++;
        this.buffer.set(this.sentCount, { ...this.data });
        this.sendCb?.(this.sentCount);
        return this.sentCount;
    }
    onSend(cb: (seq: number) => void): () => void { this.sendCb = cb; return () => { this.sendCb = undefined; }; }
    at(seq: number): Cmd | undefined { return this.buffer.get(seq); }
    reckonTimeAt(_seq: number): number { return 0; }
    get pendingCount(): number { return this.sentCount - this.lastProcessed; }
}

// Schema truth: x is FLOAT32 on the wire (like an FPS at kilometer-scale coords),
// n is auto `number` (the codec picks float32 when |loss| < 1e-4), grounded is a
// boolean (exact). STEP is a large-coordinate walk whose values are NOT
// float32-representable, so wire rounding is guaranteed present.
const WireState = schema({
    x: t.float32(),
    n: t.number(),
    grounded: t.boolean(),
});
type WireState = InstanceType<typeof WireState>;

const STRIDE = 1000.1; // fround(1000.1) !== 1000.1 — every step lands off-lattice

function make(input: FakeInput) {
    const instance = new WireState();
    instance.x = 0; instance.n = 0; instance.grounded = true;
    let stepCalls = 0;
    const recon = new Reconciler<{ x: number; n: number; grounded: boolean }, Cmd>(instance, {
        input: input as unknown as InputHandle<Cmd>,
        fields: ['x', 'n', 'grounded'],
        smoothMs: 0,
        warnOnDivergence: 1e9, // enables correction telemetry without warning
        step: (_ctx, s, cmd) => { stepCalls++; s.x += cmd.ax * STRIDE; s.n += cmd.ax * STRIDE; },
    });
    return { recon, instance, stepCalls: () => stepCalls };
}

function step(input: FakeInput, ax: number): void {
    input.data.ax = ax;
    input.send();
}

describe('wire-precision-aware reconcile', () => {
    test('float32/auto-number truth rounding is wire-indistinguishable → skip adopt+replay, keep full precision', () => {
        const input = new FakeInput();
        const { recon, instance, stepCalls } = make(input);

        step(input, 1); step(input, 1); step(input, 1); // pred x: 1000.1, 2000.2, 3000.3…
        const predAt1 = 1 * STRIDE;
        const exactLive = recon.state.x;               // full-f64 live prediction at seq 3
        assert.notEqual(Math.fround(exactLive), exactLive, 'test setup: state must be off the f32 lattice');

        // The server agreed at seq 1 — the wire delivers its state ROUNDED.
        instance.x = Math.fround(predAt1);
        instance.n = Math.fround(predAt1);             // auto `number`: loss < 1e-4 → float32 on the wire
        input.lastProcessed = 1;
        const calls = stepCalls();
        recon.tick(1);

        assert.strictEqual(recon.state.x, exactLive, 'full-precision state kept — rounding NOT adopted');
        assert.strictEqual(stepCalls(), calls, 'no replay ran (short-circuited)');
        assert.strictEqual(recon.lastCorrectionMag, 0, 'zero-correction reconcile');
        assert.strictEqual(recon.reconcileSeq, 1, 'still counted as a reconcile');
    });

    test('a REAL mispredict (difference the wire can express) still adopts + replays', () => {
        const input = new FakeInput();
        const { recon, instance, stepCalls } = make(input);

        step(input, 1); step(input, 1); step(input, 1);

        // Server disagrees at seq 1 by a full stride — far beyond wire rounding.
        const truth = Math.fround(2 * STRIDE);
        instance.x = truth; instance.n = truth;
        input.lastProcessed = 1;
        const calls = stepCalls();
        recon.tick(1);

        assert.strictEqual(stepCalls(), calls + 2, 'replayed the 2 unacked inputs');
        assert.strictEqual(recon.state.x, Math.fround(truth) + 2 * STRIDE, 'adopted truth + replay');
        assert.isAbove(recon.lastCorrectionMag, 100, 'correction recorded');
    });

    test('a boolean field mismatch defeats the skip (exact compare)', () => {
        const input = new FakeInput();
        const { recon, instance, stepCalls } = make(input);

        step(input, 1); step(input, 1);
        instance.x = Math.fround(STRIDE);
        instance.n = Math.fround(STRIDE);
        instance.grounded = false;                     // wire-exact field differs → real mispredict
        input.lastProcessed = 1;
        const calls = stepCalls();
        recon.tick(1);

        assert.strictEqual(stepCalls(), calls + 1, 'adopt+replay ran');
        assert.strictEqual(recon.state.grounded, false, 'boolean truth adopted');
    });

    test('plain-object instance (no schema metadata): identity quantizers — skip only on bit-exact truth', () => {
        const input = new FakeInput();
        const self = { x: 0 };
        let stepCalls = 0;
        const recon = new Reconciler<{ x: number }, Cmd>(self, {
            input: input as unknown as InputHandle<Cmd>,
            fields: ['x'],
            smoothMs: 0,
            step: (_ctx, s, cmd) => { stepCalls++; s.x += cmd.ax * STRIDE; },
        });

        step(input, 1); step(input, 1);

        // Bit-exact truth → skip (no replay).
        self.x = STRIDE;
        input.lastProcessed = 1;
        let calls = stepCalls;
        recon.tick(1);
        assert.strictEqual(stepCalls, calls, 'bit-exact truth short-circuits');

        // Epsilon-off truth → identity quantizer can express it → adopt + replay.
        step(input, 1);
        self.x = 2 * STRIDE + 1e-9;
        input.lastProcessed = 2;
        calls = stepCalls;
        recon.tick(2);
        assert.strictEqual(stepCalls, calls + 1, 'sub-epsilon difference adopts under identity quantizer');
    });

    test('quantizeAutoNumber pins the codec: matches a real encode.number → decode.number round trip', () => {
        // The auto `number` quantizer MIRRORS the codec's encoding decision; if
        // the codec's rule drifts (the 1e-4 loss threshold, the int32 test),
        // this is the test that fails — the others construct truth by hand.
        const q = wireQuantizerOf(new WireState(), 'n');
        const values = [
            0, 1, -7, 127, 65535, -65536, 2147483647, -2147483648,
            2147483648,               // beyond int32 → float path (f32-exact power of 2)
            0.5, 1000.1, 3000.3000000000002, 1e-5, -123.456,
            100000.12345,             // f32 loss > 1e-4 → float64 (exact)
            1e10, 3.5e38,             // beyond f32 precision/range → float64 (exact)
            NaN, Infinity, -Infinity, // codec: NaN → 0, ±Infinity → ±MAX_SAFE_INTEGER
        ];
        const buf = Buffer.alloc(16);
        for (const v of values) {
            encode.number(buf, v, { offset: 0 });
            const delivered = decode.number(buf, { offset: 0 });
            assert.strictEqual(q(v), delivered, `wire delivers ${delivered} for ${v}`);
        }
    });

    test('reset() invalidates the history — a stale ack after reset cannot certify a skip', () => {
        const input = new FakeInput();
        const { recon, instance } = make(input);

        step(input, 1); step(input, 1);
        instance.x = 777; instance.n = 777; instance.grounded = true;
        recon.reset();   // fresh life reseeds from the instance

        // A late ack for a pre-reset seq arrives; even if the truth happens to
        // round-match the OLD prediction at that seq, the ring is cleared → adopt.
        instance.x = Math.fround(STRIDE); instance.n = Math.fround(STRIDE);
        input.lastProcessed = 1;
        recon.tick(1);
        assert.strictEqual(recon.state.x, Math.fround(STRIDE), 'post-reset ack adopted truth (no stale-history skip)');
    });
});
