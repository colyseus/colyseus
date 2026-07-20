import './util';
import { describe, test } from 'vitest';
import { assert } from 'chai';

import { schema, t } from '@colyseus/schema';
import { Reconciler } from '../src/predict.ts';
import type { InputHandle } from '../src/input/InputHandle.ts';

// -----------------------------------------------------------------------------
// TODO/25 — `fields` is optional: omitted, it derives from schema metadata
// (every scalar field, sim's auto-bind walk). An explicit list stays a
// deliberate subset, guarded by a dev-only Proxy diagnostic (debug overlay
// active) that warns once per schema field `step` touches outside the list.
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
}

/** Run `fn` with `console.warn` captured; returns the captured strings. */
function captureWarn(fn: () => void): string[] {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...args: any[]) => { warns.push(args.join(' ')); };
    try { fn(); } finally { console.warn = orig; }
    return warns;
}

/** Run `fn` with the `@colyseus/sdk/debug` overlay simulated as loaded. */
function withDiagnostics(fn: () => void): void {
    const g = globalThis as { __colyseusDebug?: unknown };
    const prev = g.__colyseusDebug;
    g.__colyseusDebug = { publish() {} };
    try { fn(); } finally { g.__colyseusDebug = prev; }
}

function step(input: FakeInput, ax: number): void {
    input.data.ax = ax;
    input.send();
}

const PlayerState = schema({
    x: t.number(),
    grounded: t.boolean(),
    hp: t.uint8(),
});

describe('reconciler auto-derived fields', () => {
    test('omitted `fields` derives every schema scalar; numeric subset drives the overlay registration', () => {
        const input = new FakeInput();
        const instance = new PlayerState();
        instance.x = 0; instance.grounded = true; instance.hp = 10;
        const recon = new Reconciler<{ x: number; grounded: boolean; hp: number }, Cmd>(instance, {
            input: input as unknown as InputHandle<Cmd>,
            smoothing: 0,
            step: (_ctx, s, cmd) => { s.x += cmd.ax; },
        });

        // All scalars mirrored at construction, declaration order.
        assert.strictEqual(recon.state.x, 0);
        assert.strictEqual(recon.state.grounded, true);
        assert.strictEqual(recon.state.hp, 10);
        assert.deepEqual([...recon.boundRegistrations[0].fields], ['x', 'hp'], 'numeric subset (booleans verbatim)');

        step(input, 1);
        assert.strictEqual(recon.state.x, 1, 'step mutation lands on the derived mirror');

        // A real mispredict adopts EVERY derived field — including one the step
        // never touches (the auto-mirror covers server-driven scalars too).
        instance.x = 5; instance.hp = 3;
        input.lastProcessed = 1;
        recon.tick(1);
        assert.strictEqual(recon.state.x, 5, 'adopted truth');
        assert.strictEqual(recon.state.hp, 3, 'untouched derived field adopted');
    });

    test('wire-precision skip survives auto-derive (quantizers resolved for derived fields)', () => {
        const WireState = schema({ x: t.float32(), grounded: t.boolean() });
        const STRIDE = 1000.1; // fround(1000.1) !== 1000.1
        const input = new FakeInput();
        const instance = new WireState();
        instance.x = 0; instance.grounded = true;
        let stepCalls = 0;
        const recon = new Reconciler<{ x: number; grounded: boolean }, Cmd>(instance, {
            input: input as unknown as InputHandle<Cmd>,
            smoothing: 0,
            step: (_ctx, s, cmd) => { stepCalls++; s.x += cmd.ax * STRIDE; },
        });

        step(input, 1); step(input, 1); step(input, 1);
        const exactLive = recon.state.x;
        assert.notEqual(Math.fround(exactLive), exactLive, 'test setup: state must be off the f32 lattice');

        instance.x = Math.fround(STRIDE); // server agreed at seq 1, wire-rounded
        input.lastProcessed = 1;
        const calls = stepCalls;
        recon.tick(1);

        assert.strictEqual(recon.state.x, exactLive, 'full-precision state kept — historyOn survived derivation');
        assert.strictEqual(stepCalls, calls, 'no replay ran (short-circuited)');
    });

    test('a derived string field disables the history ring — every ack adopts (documented degradation)', () => {
        const NamedState = schema({ x: t.float32(), name: t.string() });
        const STRIDE = 1000.1;
        const input = new FakeInput();
        const instance = new NamedState();
        instance.x = 0; instance.name = 'a';
        let stepCalls = 0;
        const recon = new Reconciler<{ x: number; name: string }, Cmd>(instance, {
            input: input as unknown as InputHandle<Cmd>,
            smoothing: 0,
            step: (_ctx, s, cmd) => { stepCalls++; s.x += cmd.ax * STRIDE; },
        });

        step(input, 1); step(input, 1);
        instance.x = Math.fround(STRIDE); // wire-indistinguishable — would skip if scalar-only
        input.lastProcessed = 1;
        const calls = stepCalls;
        recon.tick(1);

        assert.strictEqual(stepCalls, calls + 1, 'adopt+replay ran (no skip with a string in the mirror)');
        assert.strictEqual(recon.state.x, Math.fround(STRIDE) + STRIDE, 'wire rounding adopted into the restore point');
    });

    test('omitted `fields` + no schema metadata throws (plain object)', () => {
        const input = new FakeInput();
        assert.throws(
            () => new Reconciler<{ x: number }, Cmd>({ x: 0 }, {
                input: input as unknown as InputHandle<Cmd>,
                step: (_ctx, s, cmd) => { s.x += cmd.ax; },
            }),
            /no `fields` given and none derivable/,
        );
    });

    test('explicit empty `fields` keeps today\'s behavior (no throw)', () => {
        const input = new FakeInput();
        assert.doesNotThrow(() => new Reconciler<{ x: number }, Cmd>({ x: 0 }, {
            input: input as unknown as InputHandle<Cmd>,
            fields: [],
            step: () => {},
        }));
    });
});

describe('reconciler explicit-subset dev diagnostic', () => {
    const XY = schema({ x: t.number(), y: t.number() });

    function makeSubset(stepFn: (ctx: any, s: any, cmd: Cmd) => void) {
        const input = new FakeInput();
        const instance = new XY();
        instance.x = 0; instance.y = 0;
        const recon = new Reconciler<{ x: number }, Cmd>(instance, {
            input: input as unknown as InputHandle<Cmd>,
            fields: ['x'],
            smoothing: 0,
            step: stepFn,
        });
        return { input, instance, recon };
    }

    test('step WRITING an undeclared schema field warns once, naming the field', () => {
        withDiagnostics(() => {
            const { input } = makeSubset((_ctx, s) => { s.y = 1; });
            const warns = captureWarn(() => { step(input, 1); step(input, 1); });
            assert.lengthOf(warns, 1, 'warn-once per field');
            assert.include(warns[0], 'step wrote "y"');
            assert.include(warns[0], '`fields`');
        });
    });

    test('step READING an undeclared schema field warns too', () => {
        withDiagnostics(() => {
            const { input } = makeSubset((_ctx, s) => { void s.y; });
            const warns = captureWarn(() => step(input, 1));
            assert.lengthOf(warns, 1);
            assert.include(warns[0], 'step read "y"');
        });
    });

    test('overlay inactive: silent, and step receives the RAW local state', () => {
        let seen: unknown;
        const { input, recon } = makeSubset((_ctx, s) => { seen = s; s.y = 1; });
        const warns = captureWarn(() => step(input, 1));
        assert.lengthOf(warns, 0, 'prod pays nothing');
        assert.strictEqual(seen, recon.state, 'raw local handed through (no proxy)');
    });

    test('overlay active + COMPLETE explicit list: raw state, no proxy machinery', () => {
        withDiagnostics(() => {
            const input = new FakeInput();
            const instance = new XY();
            instance.x = 0; instance.y = 0;
            let seen: unknown;
            const recon = new Reconciler<{ x: number; y: number }, Cmd>(instance, {
                input: input as unknown as InputHandle<Cmd>,
                fields: ['x', 'y'],
                smoothing: 0,
                step: (_ctx, s) => { seen = s; },
            });
            const warns = captureWarn(() => step(input, 1));
            assert.lengthOf(warns, 0);
            assert.strictEqual(seen, recon.state);
        });
    });

    test('non-schema scratch keys pass through unwarned', () => {
        withDiagnostics(() => {
            const { input } = makeSubset((_ctx, s) => { (s as any)._scratch = 1; void (s as any)._scratch; });
            const warns = captureWarn(() => step(input, 1));
            assert.lengthOf(warns, 0);
        });
    });

    test('auto-derived path is never proxied (nothing undeclared to watch)', () => {
        withDiagnostics(() => {
            const input = new FakeInput();
            const instance = new XY();
            instance.x = 0; instance.y = 0;
            let seen: unknown;
            const recon = new Reconciler<{ x: number; y: number }, Cmd>(instance, {
                input: input as unknown as InputHandle<Cmd>,
                smoothing: 0,
                step: (_ctx, s, cmd) => { seen = s; s.x += cmd.ax; },
            });
            const warns = captureWarn(() => step(input, 1));
            assert.lengthOf(warns, 0);
            assert.strictEqual(seen, recon.state);
        });
    });

    test('replay-only touches are covered (proxy active during rollback replay)', () => {
        withDiagnostics(() => {
            const { input, instance, recon } = makeSubset((ctx, s, cmd) => {
                s.x += cmd.ax;
                if (ctx.isReplay) s.y = 1; // undeclared write only replay reaches
            });
            const liveWarns = captureWarn(() => { step(input, 1); step(input, 1); });
            assert.lengthOf(liveWarns, 0, 'live steps never hit the branch');

            instance.x = 100; // real mispredict → adopt + replay of seq 2
            input.lastProcessed = 1;
            const replayWarns = captureWarn(() => recon.tick(1));
            assert.lengthOf(replayWarns, 1, 'replay step hit the undeclared write');
            assert.include(replayWarns[0], 'step wrote "y"');
        });
    });
});
