import './util';
import { describe, test, expect, vi } from 'vitest';
import { schema, t, Decoder } from '@colyseus/schema';
import { Predict } from '../src/predict/Predictor.ts';

const GameState = schema({ tick: t.number() }, 'ActionState');

type OnReply = (ok: boolean, payload: any, faulted: boolean) => void;

/** Minimal Room stand-in exposing only what `predict.action` touches
 *  (sendRequest / cancelRequest), plus helpers to deliver replies. */
function makeFakeRoom() {
    const replies = new Map<number, OnReply>();
    const sent: Array<{ id: number; type: any; payload: any; mode: any }> = [];
    let nextId = 0;
    let offline = false;
    return {
        clock: { serverNow: () => 0, smoothedRtt: () => 50 },
        get sent() { return sent; },
        goOffline() { offline = true; },
        sendRequest(type: any, payload: any, opts: any, onReply: OnReply) {
            if (offline) { return -1; } // unreliable + offline: not transmitted
            const id = nextId++;
            replies.set(id, onReply);
            sent.push({ id, type, payload, mode: opts.mode });
            return id;
        },
        cancelRequest(id: number) { replies.delete(id); },
        accept(id: number, ref?: number) { replies.get(id)?.(true, ref !== undefined ? { ref } : undefined, false); replies.delete(id); },
        reject(id: number, reason: any) { replies.get(id)?.(false, reason, false); replies.delete(id); },
        error(id: number, reason: any) { replies.get(id)?.(false, reason, true); replies.delete(id); },
        registered(id: number) { return replies.has(id); },
    };
}

function makeHandle() {
    const h = {
        acceptedRef: undefined as number | undefined,
        acceptCalls: 0,
        canceled: false,
        accept(ref?: number) { h.acceptCalls++; h.acceptedRef = ref; },
        cancel() { h.canceled = true; },
    };
    return h;
}

const predictOf = () => Predict.get(new Decoder(new GameState()));

describe('predict.action — orchestration', () => {
    test('fire() predicts immediately and sends the action', () => {
        const predict = predictOf();
        const room = makeFakeRoom();
        const predictFn = vi.fn(() => makeHandle());
        const fire = predict.action(room as any, 'fire', { predict: predictFn });

        fire({ x: 1, y: 2 });
        expect(predictFn).toHaveBeenCalledWith({ x: 1, y: 2 });   // ran NOW
        expect(room.sent).toHaveLength(1);
        expect(room.sent[0]).toMatchObject({ type: 'fire', payload: { x: 1, y: 2 } });
    });

    test('ACCEPT → handle.accept(ref) (disarm TTL + bind spawn refId)', () => {
        const predict = predictOf();
        const room = makeFakeRoom();
        const h = makeHandle();
        const fire = predict.action(room as any, 'fire', { predict: () => h });

        fire({});
        room.accept(0, 77);
        expect(h.acceptCalls).toBe(1);
        expect(h.acceptedRef).toBe(77);
        expect(h.canceled).toBe(false);
    });

    test('REJECTED → default rollback is handle.cancel()', () => {
        const predict = predictOf();
        const room = makeFakeRoom();
        const h = makeHandle();
        const fire = predict.action(room as any, 'fire', { predict: () => h });

        fire({});
        room.reject(0, 'cooldown');
        expect(h.canceled).toBe(true);
        expect(h.acceptCalls).toBe(0);
    });

    test('REJECTED → custom rollback receives (handle, reason), no cancel', () => {
        const predict = predictOf();
        const room = makeFakeRoom();
        const h = makeHandle();
        const rollback = vi.fn();
        const fire = predict.action(room as any, 'fire', { predict: () => h, rollback });

        fire({});
        room.reject(0, 'dead');
        expect(rollback).toHaveBeenCalledWith(h, 'dead');
        expect(h.canceled).toBe(false);
    });

    test('ERROR (handler threw) → rollback with the error payload', () => {
        const predict = predictOf();
        const room = makeFakeRoom();
        const rollback = vi.fn();
        const fire = predict.action(room as any, 'fire', { predict: () => makeHandle(), rollback });

        fire({});
        room.error(0, { name: 'Error', message: 'boom' });
        expect(rollback).toHaveBeenCalledWith(expect.anything(), { name: 'Error', message: 'boom' });
    });

    test('effect-less action (void handle) accepts/rejects without crashing', () => {
        const predict = predictOf();
        const room = makeFakeRoom();
        const fire = predict.action(room as any, 'emote', { predict: () => {} });

        fire({ kind: 'wave' });
        expect(() => room.accept(0, undefined)).not.toThrow();

        fire({ kind: 'taunt' });
        expect(() => room.reject(1, 'silenced')).not.toThrow();
    });

    test('mode is forwarded to the transport', () => {
        const predict = predictOf();
        const room = makeFakeRoom();
        const fire = predict.action(room as any, 'fire', { predict: () => makeHandle(), mode: 'unreliable' });
        fire({});
        expect(room.sent[0].mode).toBe('unreliable');
    });

    test('not transmitted (offline unreliable) still predicts; no verdict tracking', () => {
        const predict = predictOf();
        const room = makeFakeRoom();
        room.goOffline();
        const h = makeHandle();
        const predictFn = vi.fn(() => h);
        const fire = predict.action(room as any, 'fire', { predict: predictFn, mode: 'unreliable' });

        fire({});
        expect(predictFn).toHaveBeenCalled();    // optimistic local effect still ran
        expect(room.sent).toHaveLength(0);       // nothing sent
    });

    test('a lost verdict is GC-pruned by predict.tick() (no rollback — store TTL governs)', () => {
        // Controllable clock so the manager's GC window is deterministic.
        let now = 0;
        const clock = { serverNow: () => now, smoothedRtt: () => 0 } as any;
        const predict = Predict.get(new Decoder(new GameState()), { clock });
        const room = makeFakeRoom();
        const h = makeHandle();
        const fire = predict.action(room as any, 'fire', { predict: () => h });

        fire({});                                // tracked at serverNow() = 0
        expect(room.registered(0)).toBe(true);

        now = 10_000;                            // well past the GC window
        predict.tick(0);                         // drives the manager's prune()
        expect(room.registered(0)).toBe(false);  // verdict registration freed
        expect(h.canceled).toBe(false);          // GC does NOT roll back (store TTL would)
    });
});
