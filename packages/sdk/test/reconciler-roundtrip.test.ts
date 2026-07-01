import './util';
import { describe, test } from 'vitest';
import { assert } from 'chai';

import { Reconciler } from '../src/predict.ts';

// -----------------------------------------------------------------------------
// The linchpin: the reconciler predicts from the ROUND-TRIPPED wire input the
// handle buffered at `send()` (`input.at(seq)`), not any raw cmd — so a lossy wire
// transform (a `t.quantized` field) is applied identically on the live catch-up
// step, on rollback replay, and on the server. In the observer model this is
// structural: there is no raw-cmd path at all.
//
// This fake `data` SNAPS `q` to the nearest integer on write (a stand-in for
// quantization). Staging `input.data.q = …` runs that setter; `send()` snapshots
// the SNAPPED value, and both live catch-up and replay read it back via
// `input.at(seq)` — so `state.x` accumulates the snapped integers, never the raw
// fractions.
// -----------------------------------------------------------------------------

interface Cmd { q: number; }

class SnappingData {
    private _q = 0;
    get q(): number { return this._q; }
    set q(v: number) { this._q = Math.round(v); } // lossy snap, like dequant(quant(v))
}

class FakeInput {
    data = new SnappingData();
    stepMs = 1000;
    stepSeconds = 1; // dt = 1 → state.x accumulates raw sums
    subSteps = 1;
    patchRate = 1000;
    lastProcessed = 0;
    sentCount = 0;
    private buffer = new Map<number, Cmd>();
    private sendCb?: (seq: number) => void;

    send(): number {
        this.sentCount++;
        this.buffer.set(this.sentCount, { q: this.data.q }); // snapshot the SNAPPED value
        this.sendCb?.(this.sentCount);                        // notify the observing reconciler
        return this.sentCount;
    }
    onSend(cb: (seq: number) => void): () => void { this.sendCb = cb; return () => { this.sendCb = undefined; }; }
    at(seq: number): Cmd | undefined { return this.buffer.get(seq); }
    reckonTimeAt(_seq: number): number { return 0; }
    get pendingCount(): number { return this.sentCount - this.lastProcessed; }
}

/** Emulate one LIVE input step in the observer model: mutate + send through the
 *  handle (the `q` setter snaps, like quantization). The reconciler observes the
 *  send and steps it — reads (`state`) are pure. */
function step(_recon: Reconciler<{ x: number }, Cmd>, input: FakeInput, q: number): void {
    input.data.q = q;   // SnappingData setter snaps on write
    input.send();       // → onSend → reconciler steps the input
}

describe('Reconciler predicts from the round-tripped input', () => {
    test('live step uses the SNAPPED staged value, not the raw cmd', () => {
        const input = new FakeInput();
        const self = { x: 0 };
        const recon = new Reconciler<{ x: number }, Cmd>(self, {
            input: input as any,
            fields: ['x'],
            smoothing: 0, // snap mode → error is exactly the correction
            step: (_ctx, s, cmd) => { s.x += cmd.q; },
        });

        // Each cmd's fraction snaps to the nearest integer before the step sees it.
        step(recon, input, 0.7); // → 1
        step(recon, input, 2.4); // → 2
        step(recon, input, 1.5); // → 2 (round half up)

        // 1 + 2 + 2 = 5. If the live step read the raw cmd it'd be 0.7+2.4+1.5 = 4.6.
        assert.strictEqual(recon.state.x, 5, 'live step must integrate the snapped wire value');
    });

    test('reconcile shows ZERO correction because live == replay == server', () => {
        const input = new FakeInput();
        const self = { x: 0 };
        const recon = new Reconciler<{ x: number }, Cmd>(self, {
            input: input as any,
            fields: ['x'],
            smoothing: 0,
            warnOnDivergence: 100, // enables correction telemetry (lastCorrectionMag)
            step: (_ctx, s, cmd) => { s.x += cmd.q; },
        });

        step(recon, input, 0.7); // → 1
        step(recon, input, 2.4); // → 2 ; live prediction = 3

        // Server acked seq 1 (snapped q=1 → authoritative x=1).
        self.x = 1;
        input.lastProcessed = 1;
        recon.tick(1); // reconcile: adopt x=1, replay seq 2 (snapped q=2) → 3

        // Predicting from the raw cmd would leave the live state at 0.7+2.4=3.1,
        // so the reconcile would inject a 0.1 correction. The fix makes it exactly 0.
        assert.strictEqual(recon.state.x, 3, 'reconciled state matches prediction');
        assert.strictEqual(recon.lastCorrectionMag, 0, 'no pop when live matches replay/server');
    });
});
