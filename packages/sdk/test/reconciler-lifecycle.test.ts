import './util';
import { describe, test } from 'vitest';
import { assert } from 'chai';

import { schema, t } from '@colyseus/schema';
import { Reconciler } from '../src/predict.ts';
import type { InputHandle } from '../src/input/InputHandle.ts';

// -----------------------------------------------------------------------------
// TODO/27 — reconciler lifecycle: the controller follows the input handle's
// reset() via the handle's `epoch` counter (no onReconnect wiring), and a
// `snap:` threshold on RollbackOptions pops teleport-sized corrections
// (error zeroed + `prev` re-seeded) instead of gliding them out.
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
    epoch = 0;
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
    reset(): void {
        this.sentCount = 0;
        this.lastProcessed = 0;
        this.buffer.clear();
        this.epoch++;
    }
}

const PlayerState = schema({ x: t.number() });

function makeRecon(input: FakeInput, instance: InstanceType<typeof PlayerState>, opts: { smoothing?: number; snap?: number; onReconcile?: (acked: number) => void } = {}) {
    return new Reconciler<{ x: number }, Cmd>(instance, {
        input: input as unknown as InputHandle<Cmd>,
        smoothing: opts.smoothing ?? 0,
        snap: opts.snap,
        onReconcile: opts.onReconcile,
        step: (_ctx, s, cmd) => { s.x += cmd.ax; },
    });
}

function step(input: FakeInput, ax: number): void {
    input.data.ax = ax;
    input.send();
}

describe('reconciler lifecycle: epoch follow', () => {
    test('handle reset mid-flight → controller self-resets next tick (the reconnect freeze)', () => {
        const input = new FakeInput();
        const instance = new PlayerState();
        instance.x = 0;
        const recon = makeRecon(input, instance);

        // Pre-drop: 3 predicted inputs, server acked 1 (truth x = 1).
        step(input, 1); step(input, 1); step(input, 1);
        assert.equal(recon.state.x, 3, 'live prediction stepped each send');
        instance.x = 1;
        input.lastProcessed = 1;
        recon.tick(0);
        assert.equal(recon.state.x, 3, 'reconcile: adopt acked truth + replay seqs 2..3');

        // Reconnect: the handle re-zeros its seq space. No app wiring.
        input.reset();
        recon.tick(16);
        assert.equal(recon.state.x, 1, 'self-reset re-seeded from authoritative state');

        // The freeze case: without the self-reset, predictedSeq (3) sits above
        // the re-zeroed sentCount and fresh sends never step the prediction.
        step(input, 5);
        assert.equal(recon.state.x, 6, 'post-reset send steps the prediction again');

        // A fresh ack in the new seq space reconciles cleanly (no stale replay).
        instance.x = 6;
        input.lastProcessed = 1;
        recon.tick(32);
        assert.equal(recon.state.x, 6);
    });

    test('multiple resets between ticks collapse into one self-reset', () => {
        const input = new FakeInput();
        const instance = new PlayerState();
        instance.x = 0;
        const recon = makeRecon(input, instance);

        step(input, 1);
        input.reset();
        input.reset();          // epoch jumps by 2
        instance.x = 42;
        recon.tick(0);
        assert.equal(recon.state.x, 42, 'one reset re-seeded from the current truth');

        // No further epoch movement ⇒ no further re-seeding.
        instance.x = 99;
        recon.tick(16);
        assert.equal(recon.state.x, 42, 'stable epoch: truth is only adopted via reconcile');
    });

    test('an epoch-less duck-typed handle never self-resets (backward compat)', () => {
        const input = new FakeInput();
        (input as { epoch?: number }).epoch = undefined as unknown as number;
        const instance = new PlayerState();
        instance.x = 0;
        const recon = makeRecon(input, instance);

        step(input, 1); step(input, 1);
        recon.tick(0);
        recon.tick(16);
        assert.equal(recon.state.x, 2, 'prediction untouched across ticks');
    });
});

describe('reconciler lifecycle: snap threshold', () => {
    test('correction past `snap` pops: error zeroed AND prev re-seeded (no one-frame glide)', () => {
        const input = new FakeInput();
        const instance = new PlayerState();
        instance.x = 0;
        let valueAtReconcile = NaN;
        const recon = makeRecon(input, instance, {
            smoothing: 5, snap: 4,
            onReconcile: () => { valueAtReconcile = recon.value('x'); },
        });

        step(input, 0);                 // predicted x stays 0
        instance.x = 100;               // server teleports
        input.lastProcessed = 1;
        recon.tick(0);

        assert.equal(recon.state.x, 100);
        // renderAlpha is 0 right after the reconcile tick, so value() reads
        // `prev` — a pop that only zeroed `error` would still render 0 here.
        assert.equal(recon.value('x'), 100, 'popped to the corrected pose at alpha 0');
        assert.equal(valueAtReconcile, 100, 'onReconcile observed the popped pose');
    });

    test('correction below `snap` still smooths (rendered continuity, then decay)', () => {
        const input = new FakeInput();
        const instance = new PlayerState();
        instance.x = 0;
        const recon = makeRecon(input, instance, { smoothing: 5, snap: 4 });

        step(input, 0);                 // predicted x stays 0
        instance.x = 3;                 // sub-threshold correction
        input.lastProcessed = 1;
        recon.tick(0);

        assert.equal(recon.state.x, 3, 'truth adopted');
        assert.approximately(recon.value('x'), 0, 1e-9, 'rendered value unchanged at the reconcile instant');

        // Error decays out over a few smoothing windows (τ = 200ms at 5/s).
        for (let now = 100; now <= 3000; now += 100) recon.tick(now);
        assert.approximately(recon.value('x'), 3, 0.05, 'decayed onto the truth');
    });
});
