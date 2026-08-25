import './util';
import { describe, test, expect, vi } from 'vitest';

import { schema, t, Encoder, Decoder } from '@colyseus/schema';
import { Predict } from '../src/predict.ts';
import { wireConfirmOn } from '../src/predict/confirmOn.ts';

// -----------------------------------------------------------------------------
// `confirmOn` — declarative confirm binding resolved by predict.defineEvent.
// Real-schema harness: server Encoder → client Decoder; schema listeners fire
// synchronously from decode, so confirms need no tick.
// -----------------------------------------------------------------------------

const Crate = schema({ alive: t.boolean() }, 'ConfirmCrate');
const Banana = schema({ owner: t.string() }, 'ConfirmBanana');
const ConfirmState = schema({ crates: t.map(Crate), bananas: t.map(Banana) }, 'ConfirmState');

function setup() {
    const server = new ConfirmState();
    server.crates.set('a', Object.assign(new Crate(), { alive: true }));
    server.crates.set('b', Object.assign(new Crate(), { alive: true }));
    const encoder = new Encoder(server);
    const decoder = new Decoder(new ConfirmState());
    decoder.decode(Uint8Array.from(encoder.encodeAll()));
    const sync = () => decoder.decode(Uint8Array.from(encoder.encode()));
    return { server, decoder, sync };
}

describe('defineEvent confirmOn — field-flip variant', () => {
    test('the flip confirms the entry keyed by the collection key', () => {
        const { server, decoder, sync } = setup();
        const p = Predict.get(decoder);
        const onConfirm = vi.fn(), onReject = vi.fn(), onUnpredicted = vi.fn();
        const breaks = p.defineEvent<string>({
            onConfirm, onReject, onUnpredicted,
            confirmOn: { collection: 'crates', field: 'alive', equals: false },
        });

        breaks.predict('a');
        expect(breaks.has('a')).toBe(true);

        server.crates.get('a')!.alive = false; sync();
        expect(onConfirm).toHaveBeenCalledWith('a');
        expect(breaks.has('a')).toBe(false);
        expect(onReject).not.toHaveBeenCalled();
        expect(onUnpredicted).not.toHaveBeenCalled();
    });

    test('an unpredicted flip fires onUnpredicted with the key', () => {
        const { server, decoder, sync } = setup();
        const p = Predict.get(decoder);
        const onConfirm = vi.fn(), onUnpredicted = vi.fn();
        p.defineEvent<string>({
            onConfirm, onUnpredicted,
            confirmOn: { collection: 'crates', field: 'alive', equals: false },
        });

        server.crates.get('b')!.alive = false; sync();
        expect(onUnpredicted).toHaveBeenCalledWith('b');
        expect(onConfirm).not.toHaveBeenCalled();
    });

    test('a child already flipped at bind time is history, not a signal', () => {
        const { server, decoder, sync } = setup();
        server.crates.get('a')!.alive = false; sync();   // dead BEFORE the binding exists

        const p = Predict.get(decoder);
        const onUnpredicted = vi.fn(), onConfirm = vi.fn();
        p.defineEvent<string>({
            onConfirm, onUnpredicted,
            confirmOn: { collection: 'crates', field: 'alive', equals: false },
        });
        expect(onUnpredicted).not.toHaveBeenCalled();    // no immediate listen fire

        server.crates.get('b')!.alive = false; sync();   // binding still live for real flips
        expect(onUnpredicted).toHaveBeenCalledWith('b');
    });

    test('a decoder onAdd re-fire wires exactly one listener per child', () => {
        let addHandler: (child: object, key: string) => void;
        const listenCalls: unknown[][] = [];
        const cbs = {
            onAdd: (_k: string, h: any) => { addHandler = h; return () => {}; },
            onRemove: () => () => {},
            listen: (...args: unknown[]) => { listenCalls.push(args); return () => {}; },
        };
        const channel = { confirm: (_k?: string | number) => 1 };
        wireConfirmOn(cbs, channel, { collection: 'crates', field: 'alive', equals: false }, undefined);

        const child = {};
        addHandler!(child, 'a');
        addHandler!(child, 'a');   // decoder re-fire for the same ref
        expect(listenCalls.length).toBe(1);
    });
});

describe('defineEvent confirmOn — add variant', () => {
    test('an arrival settles the pending (keyless) prediction', () => {
        const { server, decoder, sync } = setup();
        const p = Predict.get(decoder);
        const onConfirm = vi.fn();
        const drops = p.defineEvent<{ x: number; z: number }>({
            onConfirm,
            confirmOn: { collection: 'bananas', event: 'add' },
        });

        drops.predict({ x: 1, z: 2 });
        expect(drops.has()).toBe(true);

        server.bananas.set('b1', Object.assign(new Banana(), { owner: 'someone' })); sync();
        expect(onConfirm).toHaveBeenCalledWith({ x: 1, z: 2 });
        expect(drops.has()).toBe(false);
    });

    test('entries already present at bind time do not settle anything', () => {
        const { server, decoder, sync } = setup();
        server.bananas.set('b0', Object.assign(new Banana(), { owner: 'x' })); sync();

        const p = Predict.get(decoder);
        const onUnpredicted = vi.fn();
        const drops = p.defineEvent<{ x: number; z: number }>({
            onUnpredicted,
            confirmOn: { collection: 'bananas', event: 'add' },
        });
        expect(onUnpredicted).not.toHaveBeenCalled();    // no onAdd replay at bind

        drops.predict({ x: 1, z: 2 });
        expect(drops.has()).toBe(true);                  // pre-existing entry didn't settle it
    });

    test('mine gates the confirm to our own entities', () => {
        const { server, decoder, sync } = setup();
        const p = Predict.get(Object.assign(decoder, { sessionId: 'me' }));
        const drops = p.defineEvent<{ x: number; z: number }>({
            confirmOn: { collection: 'bananas', event: 'add', mine: 'owner' },
        });

        drops.predict({ x: 1, z: 2 });
        server.bananas.set('theirs', Object.assign(new Banana(), { owner: 'other' })); sync();
        expect(drops.has()).toBe(true);                  // a remote add is not our confirm

        server.bananas.set('ours', Object.assign(new Banana(), { owner: 'me' })); sync();
        expect(drops.has()).toBe(false);
    });

    test('mine without a sessionId source throws at bind time', () => {
        const { decoder } = setup();
        const p = Predict.get(decoder);                  // raw Decoder — no sessionId
        expect(() => p.defineEvent<{ x: number; z: number }>({
            confirmOn: { collection: 'bananas', event: 'add', mine: 'owner' },
        })).toThrow(/sessionId/);
    });
});

describe('defineEvent confirmOn — remove variant', () => {
    test('the removal confirms the entry keyed by the removed key', () => {
        const { server, decoder, sync } = setup();
        server.bananas.set('b1', Object.assign(new Banana(), { owner: 'x' })); sync();

        const p = Predict.get(decoder);
        const onConfirm = vi.fn();
        const hits = p.defineEvent<string>({
            onConfirm,
            confirmOn: { collection: 'bananas', event: 'remove' },
        });

        hits.predict('b1');
        server.bananas.delete('b1'); sync();
        expect(onConfirm).toHaveBeenCalledWith('b1');
        expect(hits.has('b1')).toBe(false);
    });

    test('an unpredicted removal fires onUnpredicted (a remote actor consumed it)', () => {
        const { server, decoder, sync } = setup();
        server.bananas.set('b2', Object.assign(new Banana(), { owner: 'x' })); sync();

        const p = Predict.get(decoder);
        const onUnpredicted = vi.fn();
        p.defineEvent<string>({
            onUnpredicted,
            confirmOn: { collection: 'bananas', event: 'remove' },
        });

        server.bananas.delete('b2'); sync();
        expect(onUnpredicted).toHaveBeenCalledWith('b2');
    });
});

describe('defineEvent confirmOn — teardown', () => {
    test('channel.dispose() unsubscribes the binding', () => {
        const { server, decoder, sync } = setup();
        const p = Predict.get(decoder);
        const onConfirm = vi.fn(), onUnpredicted = vi.fn();
        const breaks = p.defineEvent<string>({
            onConfirm, onUnpredicted,
            confirmOn: { collection: 'crates', field: 'alive', equals: false },
        });

        breaks.dispose();
        server.crates.get('a')!.alive = false; sync();
        expect(onConfirm).not.toHaveBeenCalled();
        expect(onUnpredicted).not.toHaveBeenCalled();
    });

    test('predict.dispose() tears the binding down with the channel', () => {
        const { server, decoder, sync } = setup();
        const p = Predict.get(decoder);
        const onConfirm = vi.fn(), onUnpredicted = vi.fn();
        p.defineEvent<string>({
            onConfirm, onUnpredicted,
            confirmOn: { collection: 'crates', field: 'alive', equals: false },
        });

        p.dispose();
        server.crates.get('a')!.alive = false; sync();
        expect(onConfirm).not.toHaveBeenCalled();
        expect(onUnpredicted).not.toHaveBeenCalled();
    });
});
