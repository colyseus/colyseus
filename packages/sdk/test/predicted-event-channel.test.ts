import './util';
import { describe, test, expect, vi } from 'vitest';

import { PredictedEventChannel, SimReconciler, type SimReconcilerOptions } from '../src/predict.ts';
import type { InputHandle } from '../src/input/InputHandle.ts';

function makeClock(start = 0) {
    let t = start, rtt = 50;
    return {
        clock: { serverNow: () => t, smoothedRtt: () => rtt },
        advance: (ms: number) => { t += ms; },
        setRtt: (r: number) => { rtt = r; },
    };
}

// -----------------------------------------------------------------------------
// Channel behavior on its own (no sim) — the UI-optimistic path.
// -----------------------------------------------------------------------------

describe('PredictedEventChannel (standalone)', () => {
    test('predict fires onPredict once and dedupes while pending', () => {
        const onPredict = vi.fn();
        const { clock } = makeClock();
        const ch = new PredictedEventChannel<string>({ onPredict }, clock);

        ch.predict('goal');
        ch.predict('goal');       // pending — no re-fire
        expect(onPredict).toHaveBeenCalledTimes(1);
        expect(ch.has()).toBe(true);
        expect(ch.pendingCount).toBe(1);
    });

    test('confirm settles the entry, fires onConfirm (not onReject), returns the count', () => {
        const onConfirm = vi.fn(), onReject = vi.fn();
        const { clock } = makeClock();
        const ch = new PredictedEventChannel<string>({ onPredict: () => {}, onConfirm, onReject }, clock);

        expect(ch.confirm()).toBe(0);         // nothing pending — unpredicted event
        ch.predict('goal');
        expect(ch.confirm()).toBe(1);
        expect(onConfirm).toHaveBeenCalledWith('goal');
        expect(onReject).not.toHaveBeenCalled();
        expect(ch.has()).toBe(false);

        ch.predict('again');                  // settled channel accepts a fresh prediction
        expect(ch.pendingCount).toBe(1);
    });

    test('explicit reject fires onReject with the payload', () => {
        const onReject = vi.fn();
        const { clock } = makeClock();
        const ch = new PredictedEventChannel<string>({ onPredict: () => {}, onReject }, clock);

        ch.predict('goal');
        expect(ch.reject()).toBe(1);
        expect(onReject).toHaveBeenCalledWith('goal');
        expect(ch.has()).toBe(false);
    });

    test('TTL prune rejects an unconfirmed prediction (mispredict path)', () => {
        const onReject = vi.fn();
        const { clock, advance } = makeClock();
        const ch = new PredictedEventChannel<string>({ onPredict: () => {}, onReject, ttlMs: 100 }, clock);

        ch.predict('goal');
        advance(99);
        ch.prune();
        expect(onReject).not.toHaveBeenCalled();
        advance(2);
        ch.prune();
        expect(onReject).toHaveBeenCalledWith('goal');
        expect(ch.has()).toBe(false);
    });

    test('UI-born entries have no ack anchor — never auto-rejected by server progress', () => {
        const onReject = vi.fn();
        const { clock } = makeClock();
        const ch = new PredictedEventChannel<string>({ onPredict: () => {}, onReject, ttlMs: 10_000 }, clock);

        ch.predict('emote');                   // no timeline
        ch.prune();
        ch.prune();
        expect(onReject).not.toHaveBeenCalled(); // only its wall-clock TTL applies
        expect(ch.has()).toBe(true);
    });

    test('clear drops entries silently (no onReject)', () => {
        const onReject = vi.fn();
        const { clock } = makeClock();
        const ch = new PredictedEventChannel<string>({ onPredict: () => {}, onReject }, clock);
        ch.predict('goal');
        ch.clear();
        expect(onReject).not.toHaveBeenCalled();
        expect(ch.has()).toBe(false);
    });

    test('cooldownMs drops predictions inside the window entirely', () => {
        const onPredict = vi.fn();
        const { clock, advance } = makeClock();
        const ch = new PredictedEventChannel<string>({ onPredict, cooldownMs: 250 }, clock);

        ch.predict('hit');
        ch.confirm();                          // settled — pending no longer dedupes
        advance(100);
        ch.predict('hit');                     // inside cooldown — dropped, no entry
        expect(onPredict).toHaveBeenCalledTimes(1);
        expect(ch.has()).toBe(false);
        advance(200);                          // past the window
        ch.predict('hit');
        expect(onPredict).toHaveBeenCalledTimes(2);
    });

    test('a primitive payload is its own identity — one pending entry per value (default)', () => {
        const onPredict = vi.fn();
        const { clock } = makeClock();
        const ch = new PredictedEventChannel<string>({ onPredict }, clock);

        ch.predict('enemy-1');
        ch.predict('enemy-2');            // different identity — coexists
        ch.predict('enemy-1');            // pending — dedupes
        expect(onPredict).toHaveBeenCalledTimes(2);
        expect(ch.pendingCount).toBe(2);
        expect(ch.confirm('enemy-1')).toBe(1);
        expect(ch.has('enemy-2')).toBe(true);
    });

    test('an object payload shares one anonymous slot unless uniqueBy is declared (default)', () => {
        const onPredict = vi.fn();
        const { clock } = makeClock();
        const ch = new PredictedEventChannel<{ team: string }>({ onPredict }, clock);

        ch.predict({ team: 'left' });
        ch.predict({ team: 'right' });    // distinct objects would key by reference — singleton instead
        expect(onPredict).toHaveBeenCalledTimes(1);
        expect(ch.pendingCount).toBe(1);
    });

    test('uniqueBy holds several pending entries and settles them individually', () => {
        const onPredict = vi.fn(), onReject = vi.fn(), onConfirm = vi.fn();
        const { clock } = makeClock();
        const ch = new PredictedEventChannel<{ by: string }>({
            onPredict, onReject, onConfirm,
            uniqueBy: (p) => p.by,
        }, clock);

        ch.predict({ by: 'self' });
        ch.predict({ by: 'opponent' });
        ch.predict({ by: 'self' });            // dedupes within its key only
        expect(onPredict).toHaveBeenCalledTimes(2);
        expect(ch.pendingCount).toBe(2);
        expect(ch.has('self')).toBe(true);

        expect(ch.confirm('self')).toBe(1);
        expect(onConfirm).toHaveBeenCalledWith({ by: 'self' });
        expect(ch.has('self')).toBe(false);
        expect(ch.has('opponent')).toBe(true);

        expect(ch.reject()).toBe(1);           // no key → every remaining entry
        expect(onReject).toHaveBeenCalledWith({ by: 'opponent' });
        expect(ch.pendingCount).toBe(0);
    });

    test('dispose marks dead and drops entries silently', () => {
        const onReject = vi.fn();
        const { clock } = makeClock();
        const ch = new PredictedEventChannel<string>({ onPredict: () => {}, onReject }, clock);
        ch.predict('goal');
        ch.dispose();
        expect(ch.dead).toBe(true);
        expect(ch.has()).toBe(false);
        expect(onReject).not.toHaveBeenCalled();
    });
});

// -----------------------------------------------------------------------------
// Sim integration — ctx.predict on the rollback timeline. Same FakeInput shape
// as sim-reconciler.test.ts: send() buffers a snapshot, lastProcessed simulates
// the server ack, tick() triggers reconcile → adopt + replay.
// -----------------------------------------------------------------------------

interface Cmd { ax: number; }

class FakeInput {
    data: Cmd = { ax: 0 };
    stepMs = 1000;
    stepSeconds = 1;
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

interface World { x: number; }
interface Self { x: number; }

/** Sim harness: `x` integrates `ax`; the step predicts into `channel` when the
 *  world first crosses `x >= threshold` (edge-triggered, like a goal line). */
function makeSim(channel: PredictedEventChannel<string>, opts: {
    threshold?: number;
    /** call channel.predict() DIRECTLY from the step (the misuse the backstop catches) */
    direct?: boolean;
} = {}) {
    const threshold = opts.threshold ?? 3;
    const input = new FakeInput();
    const world: World = { x: 0 };
    const src: Self = { x: 0 };
    const simOpts: SimReconcilerOptions<Cmd, { x: number }, World> = {
        input: input as unknown as InputHandle<Cmd>,
        world,
        step: (ctx, cmd, w) => {
            const was = w.x >= threshold;
            w.x += cmd.ax * ctx.dt;
            if (w.x >= threshold && !was) {
                if (opts.direct) channel.predict('crossed');
                else ctx.predict(channel, 'crossed');
            }
        },
        adopt: (w) => { w.x = src.x; },
        pose: (w) => ({ x: w.x }),
        smoothing: 0,
    };
    const ctl = new SimReconciler<Cmd, { x: number }, World>(simOpts);
    return { input, world, src, ctl };
}

function send(input: FakeInput, ax: number): void {
    input.data.ax = ax;
    input.send();
}

describe('ctx.predict (sim-born predictions)', () => {
    test('a live crossing predicts exactly once', () => {
        const onPredict = vi.fn();
        const { clock } = makeClock();
        const ch = new PredictedEventChannel<string>({ onPredict }, clock);
        const { input } = makeSim(ch);

        send(input, 1); send(input, 1); send(input, 1);   // x: 1,2,3 → crossing at seq 3
        expect(onPredict).toHaveBeenCalledTimes(1);
        expect(onPredict).toHaveBeenCalledWith('crossed');
    });

    test('rollback replay re-derives the crossing but never re-fires — even after settlement', () => {
        const onPredict = vi.fn();
        const { clock } = makeClock();
        const ch = new PredictedEventChannel<string>({ onPredict }, clock);
        const { input, ctl, src } = makeSim(ch);

        send(input, 1); send(input, 1); send(input, 1);   // live crossing at seq 3 (x=3)
        expect(onPredict).toHaveBeenCalledTimes(1);
        ch.confirm();                                     // settled — pending-dedupe is GONE

        // Server acks seq 1 (authoritative x=1); reconcile adopts and replays
        // seqs 2..3 → x reaches 3 again: the replay RE-CROSSES the threshold.
        // Filtered by ctx.predict: no re-fire.
        src.x = 1;
        input.lastProcessed = 1;
        ctl.tick(1);
        expect(onPredict).toHaveBeenCalledTimes(1);

        // And again for the next ack — replays stay silent every reconcile.
        src.x = 2;
        input.lastProcessed = 2;
        ctl.tick(2);
        expect(onPredict).toHaveBeenCalledTimes(1);
    });

    test('a live re-crossing after settlement CAN predict again (fresh event)', () => {
        const onPredict = vi.fn();
        const { clock } = makeClock();
        const ch = new PredictedEventChannel<string>({ onPredict }, clock);
        const { input, ctl, src } = makeSim(ch);

        send(input, 1); send(input, 1); send(input, 1);   // crossing #1
        expect(onPredict).toHaveBeenCalledTimes(1);
        ch.reject();                                      // mispredict — the world moved back

        // server truth: x reset to 0; ack everything sent so far (no replays pending)
        src.x = 0;
        input.lastProcessed = 3;
        ctl.tick(1);

        send(input, 1); send(input, 1); send(input, 1);   // x: 1,2,3 again — crossing #2, live
        expect(onPredict).toHaveBeenCalledTimes(2);
    });

    test('auto-settle: an unconfirmed sim-born entry rejects once the ack passes seq + graceTicks', () => {
        const onPredict = vi.fn(), onReject = vi.fn();
        const { clock } = makeClock();
        const ch = new PredictedEventChannel<string>({ onPredict, onReject, graceTicks: 5 }, clock);
        const { input } = makeSim(ch);

        send(input, 1); send(input, 1); send(input, 1);   // crossing predicted at seq 3
        expect(onPredict).toHaveBeenCalledTimes(1);

        ch.prune();                                       // acked 0 — server hasn't caught up
        expect(onReject).not.toHaveBeenCalled();

        input.lastProcessed = 7;                          // seq 3 + grace 5 = 8 not reached
        ch.prune();
        expect(onReject).not.toHaveBeenCalled();          // within the grace window

        input.lastProcessed = 8;                          // server ran the timeline, stayed silent
        ch.prune();
        expect(onReject).toHaveBeenCalledWith('crossed'); // the event didn't happen
        expect(ch.has()).toBe(false);
    });

    test('auto-settle: confirm inside the grace window wins — no reject', () => {
        const onReject = vi.fn(), onConfirm = vi.fn();
        const { clock } = makeClock();
        const ch = new PredictedEventChannel<string>({ onPredict: () => {}, onReject, onConfirm, graceTicks: 5 }, clock);
        const { input } = makeSim(ch);

        send(input, 1); send(input, 1); send(input, 1);   // predicted at seq 3
        input.lastProcessed = 6;                          // server caught up (< 8)
        expect(ch.confirm()).toBe(1);                     // the broadcast arrived
        input.lastProcessed = 20;
        ch.prune();
        expect(onReject).not.toHaveBeenCalled();
        expect(onConfirm).toHaveBeenCalledWith('crossed');
    });

    test('sim-born entries are wall-clock-TTL-exempt — a stalled ack pipeline never fakes a verdict', () => {
        const onReject = vi.fn();
        const { clock, advance } = makeClock();
        const ch = new PredictedEventChannel<string>({ onPredict: () => {}, onReject, ttlMs: 100 }, clock);
        const { input } = makeSim(ch);

        send(input, 1); send(input, 1); send(input, 1);   // predicted at seq 3, acks stalled at 0
        advance(10_000);                                  // way past any TTL
        ch.prune();
        expect(onReject).not.toHaveBeenCalled();          // no server progress → no verdict
        expect(ch.has()).toBe(true);

        input.lastProcessed = 13;                         // pipeline resumes → verdict lands
        ch.prune();
        expect(onReject).toHaveBeenCalledWith('crossed');
    });

    test('backstop: channel.predict() called from inside a replay no-ops and warns once', () => {
        const onPredict = vi.fn();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { clock } = makeClock();
            const ch = new PredictedEventChannel<string>({ onPredict, label: 'goal' }, clock);
            const { input, ctl, src } = makeSim(ch, { direct: true }); // misuse: no ctx

            send(input, 1); send(input, 1); send(input, 1);       // live crossing fires
            expect(onPredict).toHaveBeenCalledTimes(1);
            ch.confirm();

            src.x = 1;                                            // replay re-crosses at seq 3
            input.lastProcessed = 1;
            ctl.tick(1);
            expect(onPredict).toHaveBeenCalledTimes(1);           // backstop swallowed it
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toContain('"goal"');

            src.x = 2;                                            // second replay: warn stays once
            input.lastProcessed = 2;
            ctl.tick(2);
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            warn.mockRestore();
        }
    });
});
