import './util';
import { describe, test, expect, vi } from 'vitest';
import { PredictedSpawns, type SpawnEntry } from '../src/predict/predictedSpawns.ts';

interface Bullet { ownerId: string; x: number; y: number; vx: number; vy: number; spawnTime: number; }

/** Tiny emitter mimicking `Callbacks.onAdd/onRemove("bullets", (value, key) => …)`. */
function makeCollection<S>() {
    let addCb: ((s: S, k: any) => void) | undefined;
    let removeCb: ((s: S, k: any) => void) | undefined;
    return {
        subscribe(onAdd: (s: S, k: any) => void, onRemove: (s: S, k: any) => void) {
            addCb = onAdd; removeCb = onRemove;
            return () => { addCb = undefined; removeCb = undefined; };
        },
        add(s: S, k: any = 0) { addCb?.(s, k); },
        remove(s: S, k: any = 0) { removeCb?.(s, k); },
    };
}

function makeClock(start = 0) {
    let t = start, rtt = 50;
    return {
        clock: { serverNow: () => t, smoothedRtt: () => rtt },
        advance: (ms: number) => { t += ms; },
        setRtt: (r: number) => { rtt = r; },
    };
}

const mine = (b: Bullet) => b.ownerId === 'me';
const list = <L, D>(s: PredictedSpawns<Bullet, L, D>) => [...s.entries()] as SpawnEntry<Bullet, L, D>[];

describe('PredictedSpawns', () => {
    test('spawn() renders an optimistic local immediately as a pending entry', () => {
        const { clock } = makeClock();
        const s = new PredictedSpawns<Bullet>({ owned: mine }, clock);
        const h = s.spawn({ x: 1, y: 2, vx: 0, vy: 0, spawnTime: 0 });

        expect(s.size).toBe(1);
        const [e] = list(s);
        expect(e.state).toBe('pending');
        expect(e.id).toBe(h.id);
        expect(e.local).toMatchObject({ x: 1, y: 2 });
        expect(e.server).toBeUndefined();
    });

    test('fifo: server ADD of my entity confirms the OLDEST pending under a stable id', () => {
        const { clock } = makeClock();
        const s = new PredictedSpawns<Bullet>({ owned: mine, correlate: 'fifo' }, clock);
        const coll = makeCollection<Bullet>();
        s.attach(coll.subscribe);

        const a = s.spawn({ x: 0, y: 0, vx: 0, vy: 0, spawnTime: 10 });
        const b = s.spawn({ x: 0, y: 0, vx: 0, vy: 0, spawnTime: 20 });

        const server: Bullet = { ownerId: 'me', x: 5, y: 5, vx: 0, vy: 0, spawnTime: 10 };
        coll.add(server);

        // Still exactly two logical entities — no duplicate for the server copy.
        expect(s.size).toBe(2);
        const entries = list(s);
        const confirmed = entries.find(e => e.state === 'confirmed')!;
        const pending = entries.find(e => e.state === 'pending')!;

        expect(confirmed.id).toBe(a.id);          // oldest pending was claimed
        expect(confirmed.server).toBe(server);    // authoritative now present
        expect(confirmed.local).toBeDefined();     // local retained for the handoff
        expect(pending.id).toBe(b.id);
    });

    test('foreign entity (owned=false) is a server-only entry and consumes no prediction', () => {
        const { clock } = makeClock();
        const s = new PredictedSpawns<Bullet>({ owned: mine }, clock);
        const coll = makeCollection<Bullet>();
        s.attach(coll.subscribe);

        const h = s.spawn({ x: 0, y: 0, vx: 0, vy: 0, spawnTime: 0 });
        const foreign: Bullet = { ownerId: 'them', x: 9, y: 9, vx: 0, vy: 0, spawnTime: 0 };
        coll.add(foreign);

        expect(s.size).toBe(2);
        const entries = list(s);
        const fEntry = entries.find(e => e.server === foreign)!;
        expect(fEntry.local).toBeUndefined();      // not correlated
        expect(fEntry.id).not.toBe(h.id);
        // my prediction is untouched, still pending
        expect(entries.find(e => e.id === h.id)!.state).toBe('pending');
    });

    test('predicate correlation matches by field, not arrival order', () => {
        const { clock } = makeClock();
        const s = new PredictedSpawns<Bullet, Bullet>({
            owned: mine,
            correlate: (local, server) => Math.abs(server.spawnTime - local.spawnTime) < 10,
        }, clock);
        const coll = makeCollection<Bullet>();
        s.attach(coll.subscribe);

        const a = s.spawn({ ownerId: 'me', x: 0, y: 0, vx: 0, vy: 0, spawnTime: 100 });
        const b = s.spawn({ ownerId: 'me', x: 0, y: 0, vx: 0, vy: 0, spawnTime: 200 });

        const server: Bullet = { ownerId: 'me', x: 0, y: 0, vx: 0, vy: 0, spawnTime: 205 };
        coll.add(server);

        const confirmed = list(s).find(e => e.state === 'confirmed')!;
        expect(confirmed.id).toBe(b.id);           // matched the closer spawnTime, not the oldest
    });

    test('prune() drops an unmatched prediction past TTL and fires onReject', () => {
        const onReject = vi.fn();
        const { clock, advance } = makeClock();
        // ttl: max(2*rtt, 600) with rtt=50 ⇒ 600ms
        const s = new PredictedSpawns<Bullet>({ owned: mine, onReject }, clock);
        const h = s.spawn({ x: 0, y: 0, vx: 0, vy: 0, spawnTime: 0 });

        advance(500);
        s.prune();
        expect(s.size).toBe(1);                    // within TTL

        advance(200);                              // now 700ms > 600
        s.prune();
        expect(s.size).toBe(0);
        expect(onReject).toHaveBeenCalledTimes(1);
        expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ x: 0 }), h.id);
    });

    test('onRemove drops the entry when the authoritative entity despawns', () => {
        const { clock } = makeClock();
        const s = new PredictedSpawns<Bullet>({ owned: mine }, clock);
        const coll = makeCollection<Bullet>();
        s.attach(coll.subscribe);

        s.spawn({ x: 0, y: 0, vx: 0, vy: 0, spawnTime: 0 });
        const server: Bullet = { ownerId: 'me', x: 5, y: 5, vx: 0, vy: 0, spawnTime: 0 };
        coll.add(server);
        expect(s.size).toBe(1);

        coll.remove(server);
        expect(s.size).toBe(0);
    });

    test('tick() dead-reckons pending locals; confirmed entries are left to the server', () => {
        const { clock } = makeClock();
        const s = new PredictedSpawns<Bullet, Bullet>({
            owned: mine,
            step: (b, dt) => { b.x += b.vx * dt; b.y += b.vy * dt; },
        }, clock);
        const coll = makeCollection<Bullet>();
        s.attach(coll.subscribe);

        const h = s.spawn({ ownerId: 'me', x: 0, y: 0, vx: 10, vy: 0, spawnTime: 0 });

        // first tick only seeds lastTickAt (no dt yet); second advances 1s ⇒ x += 10
        s.tick(0);
        s.tick(1000);
        expect(h.local.x).toBeCloseTo(10);

        // confirm it (single pending ⇒ fifo claims it), then tick — now frozen
        coll.add({ ownerId: 'me', x: 0, y: 0, vx: 10, vy: 0, spawnTime: 0 });
        const frozen = h.local.x;
        s.tick(2000);
        expect(h.local.x).toBe(frozen);            // confirmed local no longer stepped
    });

    test('cancel() drops a pending prediction', () => {
        const { clock } = makeClock();
        const s = new PredictedSpawns<Bullet>({ owned: mine }, clock);
        const h = s.spawn({ x: 0, y: 0, vx: 0, vy: 0, spawnTime: 0 });
        expect(s.size).toBe(1);
        h.cancel();
        expect(s.size).toBe(0);
    });

    test('dispose() detaches and marks the store dead', () => {
        const { clock } = makeClock();
        const s = new PredictedSpawns<Bullet>({ owned: mine }, clock);
        const coll = makeCollection<Bullet>();
        s.attach(coll.subscribe);
        s.spawn({ x: 0, y: 0, vx: 0, vy: 0, spawnTime: 0 });

        s.dispose();
        expect(s.dead).toBe(true);
        expect(s.size).toBe(0);
        // subscription severed: a late ADD is ignored
        coll.add({ ownerId: 'me', x: 0, y: 0, vx: 0, vy: 0, spawnTime: 0 });
        expect(s.size).toBe(0);
    });

    test('data: per-entry scratch is created on spawn, survives handoff, dropped on remove', () => {
        const { clock } = makeClock();
        const s = new PredictedSpawns<Bullet, Partial<Bullet>, { catchup: number; hidden: boolean }>(
            { owned: mine, data: () => ({ catchup: 0, hidden: false }) }, clock,
        );
        const coll = makeCollection<Bullet>();
        s.attach(coll.subscribe);

        const h = s.spawn({ x: 0, y: 0, vx: 0, vy: 0, spawnTime: 0 });
        expect(h.data).toEqual({ catchup: 0, hidden: false });
        const [e0] = list(s);
        expect(e0.data).toBe(h.data);              // same object on entry and handle
        e0.data.hidden = true;                     // mutate the scratch

        // handoff confirms the entry — scratch object must persist
        const server: Bullet = { ownerId: 'me', x: 5, y: 5, vx: 0, vy: 0, spawnTime: 0 };
        coll.add(server);
        const confirmed = list(s).find(e => e.state === 'confirmed')!;
        expect(confirmed.data).toBe(h.data);       // identical reference across handoff
        expect(confirmed.data.hidden).toBe(true);  // mutation survived

        coll.remove(server);                       // dropped with the entry
        expect(s.size).toBe(0);
    });

    test('data: foreign (server-only) entries get their own fresh scratch', () => {
        const { clock } = makeClock();
        let n = 0;
        const s = new PredictedSpawns<Bullet, Partial<Bullet>, { i: number }>(
            { owned: mine, data: () => ({ i: n++ }) }, clock,
        );
        const coll = makeCollection<Bullet>();
        s.attach(coll.subscribe);

        coll.add({ ownerId: 'them', x: 0, y: 0, vx: 0, vy: 0, spawnTime: 0 });
        const [e] = list(s);
        expect(e.local).toBeUndefined();           // foreign: no prediction
        expect(e.data).toEqual({ i: 0 });          // but still has scratch
    });

    test('data: undefined when no factory is provided', () => {
        const { clock } = makeClock();
        const s = new PredictedSpawns<Bullet>({ owned: mine }, clock);
        const h = s.spawn({ x: 0, y: 0, vx: 0, vy: 0, spawnTime: 0 });
        expect(h.data).toBeUndefined();
        expect(list(s)[0].data).toBeUndefined();
    });
});

describe('PredictedSpawns — accept() / cancel() handle behavior', () => {
    test('accept() disarms the mispredict-TTL while the authoritative patch is in flight', () => {
        const onReject = vi.fn();
        const { clock, advance } = makeClock();
        const s = new PredictedSpawns<Bullet>({ owned: mine, correlate: 'fifo', onReject }, clock);
        const coll = makeCollection<Bullet>();
        s.attach(coll.subscribe);

        const h = s.spawn({ ownerId: 'me', x: 0, y: 0, vx: 0, vy: 0, spawnTime: 0 });
        h.accept();                            // server accepted, onAdd not yet here

        advance(5000);                         // way past the 600ms TTL
        s.prune();
        expect(s.alive(h.id)).toBe(true);      // accepted ⇒ never pruned
        expect(onReject).not.toHaveBeenCalled();

        // the slow authoritative entity finally arrives and correlates (fifo)
        coll.add({ ownerId: 'me', x: 9, y: 9, vx: 0, vy: 0, spawnTime: 0 });
        const confirmed = list(s).find(e => e.state === 'confirmed')!;
        expect(confirmed.id).toBe(h.id);
    });

    test('cancel() is pending-safe — a late rollback cannot nuke a confirmed entity', () => {
        const { clock } = makeClock();
        const s = new PredictedSpawns<Bullet>({ owned: mine, correlate: 'fifo' }, clock);
        const coll = makeCollection<Bullet>();
        s.attach(coll.subscribe);

        const h = s.spawn({ ownerId: 'me', x: 0, y: 0, vx: 0, vy: 0, spawnTime: 0 });
        coll.add({ ownerId: 'me', x: 5, y: 5, vx: 0, vy: 0, spawnTime: 0 }); // confirms via fifo
        expect(list(s)[0].state).toBe('confirmed');

        h.cancel();                            // a late/duplicate rollback
        expect(s.alive(h.id)).toBe(true);      // confirmed entity survives
        expect(list(s)[0].state).toBe('confirmed');
    });
});
