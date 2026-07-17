import './util';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { assert } from 'chai';

import { schema, t, Encoder, Decoder, type SchemaType } from '@colyseus/schema';
import { Predict, SimReconciler } from '../src/predict.ts';
import type { InputHandle } from '../src/input/InputHandle.ts';

// -----------------------------------------------------------------------------
// Auto-bound world entries (TODO/24): decoded schema instances placed in
// `predict.sim`'s `world` are materialized into plain mirrors, adopted by an
// UNCONDITIONAL pull on every ack, auto-posed as "<part>.<field>", and
// registered into `predict.value(instance, field)` — one read idiom across
// remote, local, and predicted-through-your-inputs entities.
// -----------------------------------------------------------------------------

const Player = schema({
    name: t.string().default(''),
    team: t.string().default('left'),
    x: t.number().default(0),
    y: t.number().default(0),
}, 'BindPlayer');
type PlayerT = SchemaType<typeof Player>;

const Puck = schema({
    x: t.number().default(0),
    y: t.number().default(0),
    vx: t.number().default(0),
    vy: t.number().default(0),
}, 'BindPuck');
type PuckT = SchemaType<typeof Puck>;

const BindState = schema({
    players: t.map(Player),
    puck: t.ref(Puck).default(() => new Puck()),
}, 'BindGameState');

/** Encode a server state, decode it, and hand back the DECODED instances (the
 *  ones with refIds — what an app touches inside onAdd). */
function setup() {
    const server = new BindState();
    const sp = new Player();
    sp.name = 'alice'; sp.team = 'left'; sp.x = 10; sp.y = 20;
    server.players.set('p1', sp);
    server.puck.x = 100; server.puck.y = 50;

    const encoder = new Encoder(server);
    const decoder = new Decoder(new BindState());
    decoder.decode(Uint8Array.from(encoder.encodeAll()));
    const state = decoder.state as InstanceType<typeof BindState>;
    return {
        server, sp, decoder,
        player: state.players.get('p1') as PlayerT,
        puck: state.puck as PuckT,
        patch: () => decoder.decode(Uint8Array.from(encoder.encode())),
    };
}

// Minimal fake of the InputHandle subset the controllers touch (same shape as
// sim-reconciler.test.ts): stage onto `data`, `send()` buffers per seq, the
// test advances `lastProcessed` to simulate server acks. dt = 1s for integer math.
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

function captureWarn(fn: () => void): string[] {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...args: any[]) => { warns.push(args.join(' ')); };
    try { fn(); } finally { console.warn = orig; }
    return warns;
}

// -----------------------------------------------------------------------------
// Part A — SimReconciler auto-bind
// -----------------------------------------------------------------------------

describe('SimReconciler auto-bound world entries', () => {
    test('decoded entries materialize into mirrors, in place, seeded from the instance', () => {
        const { player, puck } = setup();
        const world = { paddle: player, puck };
        const me = new SimReconciler({
            input: asHandle(new FakeInput()),
            world,
            step: (_ctx, cmd: Cmd, w) => { w.paddle.x += cmd.ax; },
        });
        assert.notStrictEqual(me.world.paddle as object, player, 'the entry was replaced by a plain mirror');
        assert.strictEqual(me.world as object, world, 'replacement happened IN PLACE on the caller\'s world');
        assert.equal(me.world.paddle.x, 10, 'numeric scalar seeded');
        assert.equal(me.world.paddle.name, 'alice', 'non-numeric scalar seeded too');
        assert.equal(me.value('paddle.x'), 10, 'auto pose key "<part>.<field>"');
        assert.equal(me.value('puck.vx'), 0, 'every numeric scalar of a bound entry is posed');
    });

    test('a bound field UNCHANGED on the server is still re-seeded before replay (no double-integration)', () => {
        // The pull-adopt correctness case a push-based bindTo would break: the
        // server puck never moves (a frozen field emits NO delta), but replay
        // has mutated the mirror — without the unconditional re-copy, the next
        // replay integrates on top of the stale prediction (rubber-banding).
        const { puck } = setup();
        const input = new FakeInput();
        const me = new SimReconciler({
            input: asHandle(input),
            world: { puck },
            step: (_ctx, cmd: Cmd, w) => { w.puck.x += cmd.ax; },
        });
        for (let i = 0; i < 3; i++) { input.data.ax = 1; input.send(); }
        assert.equal(me.world.puck.x, 103, 'three pushes predicted');
        input.lastProcessed = 1;                     // server acked seq 1, truth still x=100
        me.tick(0);
        assert.equal(me.world.puck.x, 102, 'adopt pulled 100 unconditionally, then replayed seqs 2..3 (stale mirror would give 105)');
    });

    test('mixed world: bound entries auto-adopt FIRST, then user adopt covers the opaque rest', () => {
        const { player } = setup();
        const input = new FakeInput();
        const engine = { pos: 0 };
        const me = new SimReconciler({
            input: asHandle(input),
            world: { paddle: player, engine },
            step: (_ctx, cmd: Cmd, w) => { w.paddle.x += cmd.ax; w.engine.pos += cmd.ax; },
            adopt: (w) => { w.engine.pos = w.paddle.x; },   // derives from the just-adopted mirror
            pose: (w) => ({ enginePos: w.engine.pos }),
        });
        for (let i = 0; i < 3; i++) { input.data.ax = 1; input.send(); }
        assert.equal(me.world.paddle.x, 13);
        assert.equal(me.world.engine.pos, 3);
        input.lastProcessed = 1;                     // truth: paddle.x still 10
        me.tick(0);
        assert.equal(me.world.paddle.x, 12, 'bound pull (10) + replay 2..3');
        assert.equal(me.world.engine.pos, 12, 'user adopt ran AFTER the bound pull (seeded from mirror 10) + replay');
        // custom pose composes with the auto keys (correction offset still
        // decaying → approximate)
        me.tick(1000);                               // alpha → 1
        assert.approximately(me.value('enginePos'), 12, 1e-6);
        assert.approximately(me.value('paddle.x'), 12, 1e-6);
    });

    test('custom pose keys win on collision with an auto-derived bound key', () => {
        const { player } = setup();
        const me = new SimReconciler({
            input: asHandle(new FakeInput()),
            world: { paddle: player },
            step: () => {},
            pose: () => ({ 'paddle.x': 999 }),
        });
        assert.equal(me.value('paddle.x'), 999, 'the custom pose overrode the bound read');
    });

    test('non-numeric scalars are adopted verbatim but never posed', () => {
        const { player, sp, patch } = setup();
        const input = new FakeInput();
        const me = new SimReconciler({
            input: asHandle(input),
            world: { paddle: player },
            step: () => {},
        });
        input.send();
        sp.name = 'bob';
        patch();                                     // decoded player.name = 'bob'
        input.lastProcessed = 1;
        me.tick(0);
        assert.equal(me.world.paddle.name, 'bob', 'string field re-adopted on ack');
        assert.isNaN(me.value('paddle.name' as never), 'strings are not pose fields');
    });

    test('reset() reseeds through the bound pulls', () => {
        const { puck, sp: _sp } = setup();
        const input = new FakeInput();
        const me = new SimReconciler({
            input: asHandle(input),
            world: { puck },
            step: (_ctx, cmd: Cmd, w) => { w.puck.x += cmd.ax; },
        });
        for (let i = 0; i < 3; i++) { input.data.ax = 1; input.send(); }
        me.reset();
        assert.equal(me.world.puck.x, 100, 'reset adopted the authoritative value');
        input.lastProcessed = 2;
        me.tick(0);
        assert.equal(me.world.puck.x, 100, 'pre-reset inputs are not replayed');
    });

    test('construction throws: no bound entries and no adopt (no restore point)', () => {
        assert.throws(() => new SimReconciler({
            input: asHandle(new FakeInput()),
            world: { engine: { pos: 0 } },
            step: () => {},
        }), /no restore point/);
    });

    test('construction throws: schema instance without a refId (not decoded)', () => {
        assert.throws(() => new SimReconciler({
            input: asHandle(new FakeInput()),
            world: { paddle: new Player() },
            step: () => {},
        }), /hasn't been decoded/);
    });

    test('construction throws: decoded instance with no scalar fields', () => {
        const { decoder } = setup();
        assert.throws(() => new SimReconciler({
            input: asHandle(new FakeInput()),
            world: { s: decoder.state as object },
            step: () => {},
        }), /no scalar fields/);
    });
});

// -----------------------------------------------------------------------------
// Part B — the predict.value() bound overlay
// -----------------------------------------------------------------------------

describe('predict.value bound overlay', () => {
    let now = 1000;
    let nowSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        now = 1000;
        nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    });
    afterEach(() => { nowSpy.mockRestore(); });

    test('full lifecycle: raw before spawn → controller pose while bound → raw after dispose', () => {
        const { decoder, player } = setup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100 });
        assert.equal(p.value(player, 'x'), 10, 'raw fallback before any controller exists');

        const input = new FakeInput();
        const me = p.sim({
            input: asHandle(input),
            world: { paddle: player },
            step: (_ctx, cmd, w) => { w.paddle.x += cmd.ax; },
        });
        assert.equal(p.value(player, 'x'), 10, 'bound read (pose seed) right after spawn');

        p.tick(1000);                                // prime the render clock
        input.data.ax = 5; input.send();             // mirror x → 15
        p.tick(2000);                                // alpha → 1
        assert.equal(p.value(player, 'x'), 15, 'predict.value reads the controller pose');
        assert.equal(me.value('paddle.x'), 15, 'same value through the handle read');
        assert.equal(player.x, 10, 'the decoded tree was never mutated (step ran on the mirror)');

        me.dispose();
        assert.equal(p.value(player, 'x'), 10, 'raw fallback restored after dispose');
    });

    test('stash/restore: a passive lerp slot keeps sampling while overlaid and resumes on dispose', () => {
        const { decoder, player, sp, patch } = setup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100 });
        p.attachAll('players', { x: 'lerp' });       // sample #1: (1000, 10)

        now = 1100; sp.x = 20; patch();              // sample #2: (1100, 20)
        now = 1150; p.tick(1150);                    // render target 1050 → midway
        assert.approximately(p.value(player, 'x'), 15, 0.5, 'lerp interpolates before the sim exists');

        const input = new FakeInput();
        const me = p.sim({
            input: asHandle(input),
            world: { paddle: player },
            step: (_ctx, cmd, w) => { w.paddle.x += cmd.ax; },
        });
        assert.equal(p.value(player, 'x'), 20, 'overlay took over (pose seeded from current truth)');

        now = 1200; sp.x = 30; patch();              // sample #3 lands in the STASHED slot's ring
        assert.equal(p.value(player, 'x'), 20, 'still the controller pose (raw is 30 — distinct)');

        me.dispose();                                // restore the passive slot
        now = 1250; p.tick(1250);                    // target 1150 → between (1100,20) and (1200,30)
        assert.approximately(p.value(player, 'x'), 25, 0.5, 'lerp resumed seamlessly — the stashed ring kept filling');
    });

    test('attach-after-sim: the overlay wins; the new passive slot installs underneath', () => {
        const { decoder, player, sp, patch } = setup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100 });

        const input = new FakeInput();
        const me = p.sim({
            input: asHandle(input),
            world: { paddle: player },
            step: (_ctx, cmd, w) => { w.paddle.x += cmd.ax; },
        });
        p.attachAll('players', { x: 'lerp' });       // fires for the existing child → stash (sample (1000, 10))
        assert.equal(p.value(player, 'x'), 10, 'controller pose still wins after the later attach');

        now = 1100; sp.x = 20; patch();              // sample lands in the stash
        assert.equal(p.value(player, 'x'), 10, 'overlay unaffected by patches');

        me.dispose();
        now = 1150; p.tick(1150);                    // target 1050 → midway of (1000,10)..(1100,20)
        assert.approximately(p.value(player, 'x'), 15, 0.5, 'the underneath-installed lerp took over on dispose');
    });

    test('untrack on a bound mapping removes only the passive registration', () => {
        const { decoder, player, sp, patch } = setup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100 });
        p.attachAll('players', { x: 'lerp' });

        const input = new FakeInput();
        const me = p.sim({
            input: asHandle(input),
            world: { paddle: player },
            step: (_ctx, cmd, w) => { w.paddle.x += cmd.ax; },
        });
        p.untrack(player, 'x');                      // frees the stash, keeps the overlay
        assert.equal(p.value(player, 'x'), 10, 'overlay survives untrack');

        now = 1100; sp.x = 20; patch();
        me.dispose();                                // nothing stashed → mapping deleted
        now = 1150; p.tick(1150);
        assert.equal(p.value(player, 'x'), 20, 'raw fallback (no lerp midpoint — the passive slot is gone)');
    });

    test('entity removal while bound tears the overlay down; controller dispose is a safe no-op', () => {
        const { decoder, player } = setup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100 });

        const input = new FakeInput();
        const me = p.sim({
            input: asHandle(input),
            world: { paddle: player },
            step: (_ctx, cmd, w) => { w.paddle.x += cmd.ax; },
        });
        p.tick(1000);
        input.data.ax = 5; input.send();
        p.tick(2000);
        assert.equal(p.value(player, 'x'), 15);

        p.detach(player);                            // entity died (attachAll onRemove path)
        assert.equal(p.value(player, 'x'), 10, 'raw fallback after detach');
        me.dispose();                                // side entries already gone — must not throw
        assert.equal(p.value(player, 'x'), 10);
    });

    test('same (instance, field) bound twice warns; the newer registration wins', () => {
        const { decoder, puck } = setup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100 });

        const a = new FakeInput();
        p.sim({ input: asHandle(a), world: { puck }, step: (_ctx, cmd, w) => { w.puck.x += cmd.ax; } });
        const b = new FakeInput();
        let second!: SimReconciler<Cmd, {}, { puck: PuckT }>;
        const warns = captureWarn(() => {
            second = p.sim({ input: asHandle(b), world: { puck }, step: (_ctx, cmd, w) => { w.puck.x += 10 * cmd.ax; } });
        });
        assert.isAbove(warns.filter(w => w.includes('already bound')).length, 0, 'duplicate claim warns');

        p.tick(1000);
        b.data.ax = 1; b.send();                     // steps ONLY the second controller
        p.tick(2000);
        assert.equal(p.value(puck, 'x'), 110, 'the newer controller backs the read');
        void second;
    });

    test('a superseded controller\'s dispose must not tear down the winner\'s overlay', () => {
        // The free-list recycles the loser's slot index as the WINNER's slot, so
        // the loser's stale unregister must identity-check before tearing down.
        const { decoder, puck } = setup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100 });

        const a = new FakeInput();
        const first = p.sim({ input: asHandle(a), world: { puck }, step: (_ctx, cmd, w) => { w.puck.x += cmd.ax; } });
        const b = new FakeInput();
        let winner!: SimReconciler<Cmd, {}, { puck: PuckT }>;
        captureWarn(() => {
            winner = p.sim({ input: asHandle(b), world: { puck }, step: (_ctx, cmd, w) => { w.puck.x += 10 * cmd.ax; } });
        });

        first.dispose();                             // stale unregister — must be a no-op
        p.tick(1000);
        b.data.ax = 1; b.send();
        p.tick(2000);
        assert.equal(p.value(puck, 'x'), 110, 'the winner\'s overlay survived the loser\'s dispose');

        winner.dispose();
        assert.equal(p.value(puck, 'x'), 100, 'raw fallback after the winner disposes');
    });

    test('predict.reconciler registers its instance the same way (surface-wide unification)', () => {
        const { decoder, player } = setup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100 });
        const input = new FakeInput();
        const me = p.reconciler(player, {
            input: asHandle(input),
            fields: ['x', 'y'],
            step: (_ctx, state, cmd) => { state.x += cmd.ax; },
        });
        p.tick(1000);
        input.data.ax = 5; input.send();
        p.tick(2000);
        assert.equal(p.value(player, 'x'), 15, 'flat Reconciler pose through predict.value');
        assert.equal(player.x, 10, 'decoded tree untouched');
        me.dispose();
        assert.equal(p.value(player, 'x'), 10, 'raw fallback after dispose');
    });

    test('the demo shape: paddle + puck bound; every entity reads through one idiom', () => {
        const { decoder, player, puck } = setup();
        const p = Predict.get(decoder, { mode: 'lerp', delay: 100 });
        const input = new FakeInput();
        p.sim({
            input: asHandle(input),
            world: { paddle: player, puck },
            step: (_ctx, cmd, w) => {
                w.paddle.x += cmd.ax;
                w.puck.x += w.puck.vx;
                if (w.paddle.x >= w.puck.x) w.puck.vx = 2;   // "hit" imparts velocity
            },
        });
        p.tick(1000);
        input.data.ax = 100; input.send();           // paddle 10→110, crosses puck at 100 → vx 2
        p.tick(2000);
        input.data.ax = 0; input.send();             // puck 100→102
        p.tick(3000);
        assert.equal(p.value(player, 'x'), 110, 'local paddle via the same idiom as remotes');
        assert.equal(p.value(puck, 'x'), 102, 'the predicted puck — no bridge object, no invented namespace');
    });
});
