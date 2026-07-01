import './util';
import { describe, test } from 'vitest';
import { assert } from 'chai';

import { schema, t, Encoder, Decoder } from '@colyseus/schema';
import { Predict } from '../src/predict.ts';
import type { InputHandle } from '../src/input/InputHandle.ts';

// -----------------------------------------------------------------------------
// predict.onStep(cb): registered input pumps run once per due fixed step INSIDE
// tick(), after the reconcile/decay pass — so sends land at the protocol-correct
// moment for engines whose input-filling code can't live next to the tick call
// (per-object update ordering). See PREDICTION.md §4 (frame order).
// -----------------------------------------------------------------------------

interface Cmd { ax: number; }

class FakeInput {
    data: Cmd = { ax: 0 };
    stepMs = 100;
    stepSeconds = 0.1;
    patchRate?: number;
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

const OnStepState = schema({ x: t.number() }, 'OnStepState');

function makePredict(name: string) {
    const server = new OnStepState();
    const encoder = new Encoder(server);
    const decoder = new Decoder(new OnStepState());
    decoder.decode(Uint8Array.from(encoder.encodeAll()));
    return Predict.get(decoder, { mode: 'lerp', delay: 100, name });
}

describe('predict.onStep (registered input pump)', () => {
    test('pump runs once per due fixed step, inside tick; sends step the sim', () => {
        const p = makePredict('onstep-basic');
        const input = new FakeInput();
        const world = { x: 0 };
        p.sim({
            input: input as unknown as InputHandle<Cmd>,
            world,
            step: (_ctx, cmd, w) => { w.x += cmd.ax; },
            adopt: () => {},
            pose: (w) => ({ x: w.x }),
        });

        let pumped = 0;
        const off = p.onStep(() => { pumped++; input.data.ax = 1; input.send(); });

        assert.equal(p.tick(0), 0, 'prime frame (dt 0) owes no steps');
        assert.equal(pumped, 0);

        assert.equal(p.tick(100), 1, 'tick still RETURNS the count (inline-loop contract)');
        assert.equal(pumped, 1, 'one step due → pump ran once');
        assert.equal(world.x, 1, 'the pump\'s send stepped the sim');

        p.tick(400); // 3 steps due
        assert.equal(pumped, 4);
        assert.equal(world.x, 4);

        off();
        p.tick(500);
        assert.equal(pumped, 4, 'unsubscribed pump no longer runs');
    });

    test('pump sends land before post-tick reads — no read-before-pump warning', () => {
        const p = makePredict('onstep-order');
        const input = new FakeInput();
        const world = { x: 0 };
        const me = p.sim({
            input: input as unknown as InputHandle<Cmd>,
            world,
            step: (_ctx, cmd, w) => { w.x += cmd.ax; },
            adopt: () => {},
            pose: (w) => ({ x: w.x }),
        });
        p.onStep(() => { input.data.ax = 1; input.send(); });

        const warns: string[] = [];
        const orig = console.warn;
        console.warn = (...args: any[]) => { warns.push(args.join(' ')); };
        try {
            p.tick(0);
            for (let f = 1; f <= 5; f++) {
                p.tick(f * 100);
                me.value('x'); // "pre-pump" from the caller's view — already post-send
            }
        } finally { console.warn = orig; }
        assert.lengthOf(warns.filter(w => w.includes('read BEFORE')), 0);
    });
});
