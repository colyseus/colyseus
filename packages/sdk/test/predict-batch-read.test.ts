import './util';
import { afterEach, beforeEach, describe, expectTypeOf, test, vi } from 'vitest';
import { assert } from 'chai';

import { schema, t, Encoder, Decoder, type SchemaType } from '@colyseus/schema';
import { Predict } from '../src/predict.ts';
import type { InputHandle } from '../src/input/InputHandle.ts';

// -----------------------------------------------------------------------------
// Batch reads (TODO/30): `read(instance, fields, out?)` / `readAt(instance,
// fields, time, out?)` mirror the server's `seen.read` — same shape, same
// scratch contract. The batch must equal per-field value()/valueAt() across
// every mode (incl. the bound overlay), and readAt must run the forward reckon
// integration ONCE per batch instead of once per field.
// -----------------------------------------------------------------------------

const Enemy = schema({
    x: t.number(),
    y: t.number(),
    vx: t.number(),
    hp: t.number(),
}, 'BatchEnemy');
type EnemyT = SchemaType<typeof Enemy>;

const GameState = schema({ enemies: t.map(Enemy) }, 'BatchState');

let stepCalls = 0;
let atSeq = 0;   // unique Predict names across tests
const step = (s: { x: number; vx: number }, dt: number) => { stepCalls++; s.x += s.vx * dt; };
// serverNow − lastServerTime = 100ms snapshot age → reckon forwards by 100ms.
const clock = { serverNow: () => 1100, rtt: () => 100, smoothedRtt: () => 100, lastServerTime: () => 1000, sample() {} };

function roundTrip(setup: (state: any) => void) {
    const server = new GameState();
    setup(server);
    const encoder = new Encoder(server);
    const client = new GameState();
    const decoder = new Decoder(client);
    decoder.decode(Uint8Array.from(encoder.encodeAll()));
    return { server, client, decoder, encoder };
}

const enemy = (over: Record<string, number> = {}) =>
    Object.assign(new Enemy(), { x: 10, y: 5, vx: 2, hp: 50, ...over });

// Two-field lerp fixture (attach-compose pattern): patch pushes x:10→20, y:5→40.
function lerpSetup() {
    const { server, decoder, encoder } = roundTrip((s) => s.enemies.set('a', enemy()));
    const ce = () => (decoder.state as any).enemies.get('a');
    const patch = () => { const e = server.enemies.get('a')!; e.x = 20; e.y = 40; decoder.decode(Uint8Array.from(encoder.encode())); };
    return { decoder, ce, patch };
}

// Bound-overlay fixture (sim-world-bindings pattern).
const BindPlayer = schema({ x: t.number().default(0), y: t.number().default(0) }, 'BatchBindPlayer');
type BindPlayerT = SchemaType<typeof BindPlayer>;
const BindState = schema({ players: t.map(BindPlayer) }, 'BatchBindState');

function bindSetup() {
    const server = new BindState();
    const sp = new BindPlayer();
    sp.x = 10; sp.y = 20;
    server.players.set('p1', sp);
    const encoder = new Encoder(server);
    const decoder = new Decoder(new BindState());
    decoder.decode(Uint8Array.from(encoder.encodeAll()));
    const state = decoder.state as InstanceType<typeof BindState>;
    return { decoder, player: state.players.get('p1') as BindPlayerT };
}

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
const asHandle = (i: FakeInput) => i as unknown as InputHandle<Cmd>;

describe('predict.read — batch render reads', () => {
    let now = 1000;
    let nowSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        stepCalls = 0;
        now = 1000;
        nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    });
    afterEach(() => { nowSpy.mockRestore(); });

    test('lerp: batch interpolates and equals per-field value()', () => {
        const { decoder, ce, patch } = lerpSetup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100, name: 'batch-lerp' });
        p.attachAll('enemies', { x: 'lerp', y: 'lerp' });

        now = 1100; patch();
        now = 1150; p.tick(1150);                // render target 1050, midway → interpolate
        const r = p.read(ce(), ['x', 'y']);
        assert.approximately(r.x, 15, 0.5, 'x interpolated, not raw 20');
        assert.approximately(r.y, 22.5, 0.5, 'y interpolated');
        assert.equal(r.x, p.value(ce(), 'x'));
        assert.equal(r.y, p.value(ce(), 'y'));
    });

    test('damped / extrapolate / raw: batch equals per-field value()', () => {
        for (const mode of ['damped', 'extrapolate', 'raw'] as const) {
            const { decoder, ce, patch } = lerpSetup();
            const p = Predict.get(decoder, { mode: 'lerp', delay: 100, name: `batch-${mode}` });
            p.attachAll('enemies', { x: mode, y: mode });

            now = 1100; patch();
            now = 1150; p.tick(1150);
            const r = p.read(ce(), ['x', 'y']);
            assert.equal(r.x, p.value(ce(), 'x'), `${mode}: x batch === value()`);
            assert.equal(r.y, p.value(ce(), 'y'), `${mode}: y batch === value()`);
        }
    });

    test('reckon: batch equals value() with ONE advance per frame', () => {
        const { decoder } = roundTrip((s) => s.enemies.set('a', enemy()));
        const p = Predict.get(decoder, { mode: 'lerp', name: 'batch-reckon', clock });
        p.attachAll('enemies', { mode: 'reckon', fields: ['x', 'y', 'vx'], step, smoothing: 0 });
        const ce = (decoder.state as any).enemies.get('a');

        p.tick(0);
        const r = p.read(ce, ['x', 'y', 'vx']);
        assert.approximately(r.x, 10.2, 1e-6, 'dead-reckoned 100ms forward');
        const after = stepCalls;

        // Same frame: batch + per-field reads share the one advance.
        const r2 = p.read(ce, ['x', 'y', 'vx']);
        assert.equal(r2.x, p.value(ce, 'x'));
        assert.equal(r2.y, p.value(ce, 'y'));
        assert.equal(r2.vx, p.value(ce, 'vx'));
        assert.equal(stepCalls, after, 'applySimulation guard held — no extra advance');
    });

    test('scratch: filled, returned, extra props untouched; no scratch → fresh exact-shape object', () => {
        const { decoder, ce, patch } = lerpSetup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100, name: 'batch-scratch' });
        p.attachAll('enemies', { x: 'lerp', y: 'lerp' });
        now = 1100; patch();
        now = 1150; p.tick(1150);

        const scratch = { x: 0, y: 0, alive: true };
        const r = p.read(ce(), ['x', 'y'], scratch);
        assert.strictEqual(r, scratch, 'the scratch itself is returned');
        assert.approximately(scratch.x, 15, 0.5, 'scratch filled');
        assert.strictEqual(scratch.alive, true, 'extra props left untouched');

        const fresh = p.read(ce(), ['x', 'y']);
        assert.deepEqual(Object.keys(fresh).sort(), ['x', 'y'], 'omitted out → exactly the listed keys');
    });

    test('untracked instance and untracked field fall through to live values', () => {
        const { decoder } = roundTrip((s) => s.enemies.set('a', enemy()));
        const p = Predict.get(decoder, { mode: 'lerp', name: 'batch-untracked', clock });
        const ce = (decoder.state as any).enemies.get('a');

        // Decoded but never attached → live truth.
        assert.deepEqual(p.read(ce, ['x', 'y']), { x: 10, y: 5 });
        // Plain object (no refId at all) → its own values.
        assert.deepEqual(p.read({ x: 7, y: 8 }, ['x', 'y']), { x: 7, y: 8 });

        // Attached instance, but 'hp' is outside the tracked field set → live.
        p.attachAll('enemies', { mode: 'reckon', fields: ['x', 'y', 'vx'], step, smoothing: 0 });
        p.tick(0);
        const r = p.read(ce, ['x', 'hp']);
        assert.approximately(r.x, 10.2, 1e-6, 'tracked field reckoned');
        assert.equal(r.hp, 50, 'untracked field reads live');
    });

    test('bound overlay: batch reads the controller pose, falls back after dispose', () => {
        const { decoder, player } = bindSetup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100, name: 'batch-bound' });
        const input = new FakeInput();
        const me = p.sim({
            input: asHandle(input),
            world: { paddle: player },
            step: (_ctx, cmd: Cmd, w) => { w.paddle.x += cmd.ax; },
        });

        p.tick(1000);
        input.data.ax = 5; input.send();             // mirror x → 15
        p.tick(2000);
        const r = p.read(player, ['x', 'y']);
        assert.equal(r.x, 15, 'batch routes through the controller pose');
        assert.equal(r.x, p.value(player, 'x'));
        assert.equal(r.y, p.value(player, 'y'));

        me.dispose();
        assert.equal(p.read(player, ['x']).x, 10, 'raw fallback restored after dispose');
    });

    test('field-list type drives the result shape', () => {
        const { decoder } = roundTrip((s) => s.enemies.set('a', enemy()));
        const p = Predict.get(decoder, { mode: 'lerp', name: 'batch-types', clock });
        const ce = (decoder.state as any).enemies.get('a') as EnemyT;
        const POS = ['x', 'y'] as const;
        expectTypeOf(p.read(ce, POS)).toEqualTypeOf<Record<'x' | 'y', number>>();
    });
});

describe('predict.readAt — batch reads at an instant', () => {
    beforeEach(() => { stepCalls = 0; });

    function reckonSetup() {
        const { decoder } = roundTrip((s) => s.enemies.set('a', enemy()));
        const p = Predict.get(decoder, { mode: 'lerp', name: `batch-at-${++atSeq}`, clock });
        const ce = (decoder.state as any).enemies.get('a');
        return { p, ce };
    }

    test('batch equals per-field valueAt (and the closed form) at time=1200', () => {
        const { p, ce } = reckonSetup();
        p.attachAll('enemies', { mode: 'reckon', fields: ['x', 'y', 'vx'], step, smoothing: 0 });
        p.tick(0);

        const r = p.readAt(ce, ['x', 'y', 'vx'], 1200);
        // Anchors valueAt itself: x = 10 + vx·(1200−1000)ms = 10.4.
        assert.approximately(r.x, 10.4, 1e-6, 'forwarded 200ms from the snapshot');
        for (const f of ['x', 'y', 'vx'] as const) {
            assert.equal(r[f], p.valueAt(ce, f, 1200), `${f}: batch === per-field valueAt`);
        }
    });

    test('mixed batch: reckon fields forward to time, lerp field ignores it', () => {
        const { p, ce } = reckonSetup();
        p.attachAll('enemies', { mode: 'reckon', fields: ['x', 'vx'], step, smoothing: 0 });
        p.attachAll('enemies', { y: 'lerp' });
        p.tick(0);

        const r = p.readAt(ce, ['x', 'vx', 'y'], 1200);
        assert.approximately(r.x, 10.4, 1e-6, 'reckon field forwarded');
        assert.equal(r.y, p.value(ce, 'y'), 'non-reckon field reads as value(), time ignored');
    });

    test('one advance per batch vs one per field hand-rolled', () => {
        const { p, ce } = reckonSetup();
        p.attachAll('enemies', { mode: 'reckon', fields: ['x', 'y', 'vx'], step, smoothing: 0 });
        p.tick(0);

        const b0 = stepCalls;
        p.valueAt(ce, 'x', 1200);
        const perWindow = stepCalls - b0;            // substeps of ONE 200ms window
        assert.isAbove(perWindow, 0, 'the window integrates at least one substep');

        const b1 = stepCalls;
        p.valueAt(ce, 'y', 1200);
        p.valueAt(ce, 'vx', 1200);
        assert.equal(stepCalls - b1, 2 * perWindow, 'hand-rolled loop pays one window PER FIELD');

        const b2 = stepCalls;
        const r = p.readAt(ce, ['x', 'y', 'vx'], 1200);
        assert.equal(stepCalls - b2, perWindow, 'batch pays ONE window for all fields');
        assert.approximately(r.x, 10.4, 1e-6);
    });

    test('time at/before the snapshot clamps to it', () => {
        const { p, ce } = reckonSetup();
        p.attachAll('enemies', { mode: 'reckon', fields: ['x', 'y', 'vx'], step, smoothing: 0 });
        p.tick(0);
        assert.approximately(p.readAt(ce, ['x'], 900).x, 10, 1e-6, 'no reckoning into the past');
    });

    test('scratch as 4th arg; untracked field in the batch reads live', () => {
        const { p, ce } = reckonSetup();
        p.attachAll('enemies', { mode: 'reckon', fields: ['x', 'y', 'vx'], step, smoothing: 0 });
        p.tick(0);

        const scratch = { x: 0, hp: 0 };
        const r = p.readAt(ce, ['x', 'hp'], 1200, scratch);
        assert.strictEqual(r, scratch, 'scratch filled and returned');
        assert.approximately(scratch.x, 10.4, 1e-6);
        assert.equal(scratch.hp, 50, 'untracked field reads live, ignores time');
    });
});
