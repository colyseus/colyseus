import './util';
import { describe, test } from 'vitest';
import { assert } from 'chai';

import { schema, t, Encoder, Decoder } from '@colyseus/schema';
import { Predict, Reconciler } from '../src/predict.ts';
import type { InputHandle } from '../src/input/InputHandle.ts';

// -----------------------------------------------------------------------------
// ctx.reckonTime zero-sentinel resolution (TODO/26): an unstamped seq resolves
// to the clock's live serverNow() at context-fill time — the fallback every
// consumer previously hand-wrote — and ctx.lagCompActive carries the raw
// "was this seq stamped" bit. Stamped seqs stay per-seq-buffered and
// replay-deterministic; a bare clock-less controller keeps the legacy 0.
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
    /** seq → reckon stamp; absent = unstamped (reckonTimeAt returns 0). */
    reckonTimes = new Map<number, number>();
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
    reckonTimeAt(seq: number): number { return this.reckonTimes.get(seq) ?? 0; }
    get pendingCount(): number { return this.sentCount - this.lastProcessed; }
}
const asHandle = (i: FakeInput) => i as unknown as InputHandle<Cmd>;

/** Capture what the step context reported for each invocation. */
interface Seen { seq: number; reckonTime: number; lagCompActive: boolean; isReplay: boolean; }

function makeRecon(input: FakeInput, seen: Seen[], clock?: { serverNow(): number }) {
    return new Reconciler<{ x: number }, Cmd>({ x: 0 }, {
        input: asHandle(input),
        fields: ['x'],
        smoothMs: 0,
        clock,
        step: (ctx, s, cmd) => {
            seen.push({ seq: ctx.tick, reckonTime: ctx.reckonTime, lagCompActive: ctx.lagCompActive, isReplay: ctx.isReplay });
            s.x += cmd.ax;
        },
    });
}

describe('ctx.reckonTime resolution + lagCompActive', () => {
    test('bare controller without a clock keeps the legacy 0 (unstamped)', () => {
        const input = new FakeInput();
        const seen: Seen[] = [];
        makeRecon(input, seen);
        input.data.ax = 1; input.send();
        assert.strictEqual(seen[0].reckonTime, 0, 'no clock → raw 0 preserved');
        assert.strictEqual(seen[0].lagCompActive, false);
    });

    test('unstamped seq resolves to the clock\'s live serverNow()', () => {
        const input = new FakeInput();
        const seen: Seen[] = [];
        makeRecon(input, seen, { serverNow: () => 5555 });
        input.data.ax = 1; input.send();
        assert.strictEqual(seen[0].reckonTime, 5555, 'unstamped → serverNow()');
        assert.strictEqual(seen[0].lagCompActive, false, 'resolved value is NOT a lag-comp stamp');
    });

    test('stamped seq reads the per-seq stamp — live and on replay, ignoring the live clock', () => {
        const input = new FakeInput();
        const seen: Seen[] = [];
        let now = 10_000;
        const recon = makeRecon(input, seen, { serverNow: () => now });
        input.reckonTimes.set(1, 1234);
        input.reckonTimes.set(2, 2345);
        input.data.ax = 1; input.send();   // seq 1 live
        input.data.ax = 1; input.send();   // seq 2 live
        assert.deepEqual(seen.map((s) => [s.reckonTime, s.lagCompActive]), [[1234, true], [2345, true]]);

        // Server acks seq 1 → reconcile replays seq 2. The clock has moved on;
        // the replay must still see the buffered per-seq stamp (determinism).
        now = 99_999;
        input.lastProcessed = 1;
        recon.tick(1);
        const replay = seen[2];
        assert.strictEqual(replay.isReplay, true, 'third invocation is the replay of seq 2');
        assert.strictEqual(replay.seq, 2);
        assert.strictEqual(replay.reckonTime, 2345, 'replay reads the stamp, not the live clock');
        assert.strictEqual(replay.lagCompActive, true);
    });

    test('unstamped replay re-reads the live serverNow() (documented: never deterministic)', () => {
        const input = new FakeInput();
        const seen: Seen[] = [];
        let now = 7000;
        const recon = makeRecon(input, seen, { serverNow: () => now });
        input.data.ax = 1; input.send();   // seq 1, unstamped → 7000
        input.data.ax = 1; input.send();   // seq 2, unstamped → 7000
        now = 8000;
        input.lastProcessed = 1;
        recon.tick(1);                     // replay seq 2 → live 8000
        assert.strictEqual(seen[2].reckonTime, 8000, 'unstamped replay resolves at replay time');
        assert.strictEqual(seen[2].lagCompActive, false);
    });

    test('predict factory injects the Predict\'s clock into spawned controllers', () => {
        const Player = schema({ x: t.number().default(0) }, 'ReckonPlayer');
        const State = schema({ players: t.map(Player) }, 'ReckonState');
        const server = new State();
        server.players.set('p1', new Player());
        const encoder = new Encoder(server);
        const decoder = new Decoder(new State());
        decoder.decode(Uint8Array.from(encoder.encodeAll()));
        const player = (decoder.state as InstanceType<typeof State>).players.get('p1')!;

        const clock = { serverNow: () => 4242, lastServerTime: () => 4000, sample() {} };
        const p = Predict.get(decoder, { clock: clock as any });
        const seenTimes: number[] = [];
        const input = new FakeInput();
        p.sim({
            input: asHandle(input),
            world: { paddle: player },
            step: (ctx, w, cmd) => { seenTimes.push(ctx.reckonTime); w.paddle.x += cmd.ax; },
        });
        input.data.ax = 1; input.send();
        assert.deepEqual(seenTimes, [4242], 'unstamped step resolved through the injected room clock');
    });
});
