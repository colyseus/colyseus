import './util';
import { describe, test } from 'vitest';
import { assert } from 'chai';

import { Protocol, ProtocolModifier } from '@colyseus/shared-types';
import { InputEncoder } from '@colyseus/schema/input';
import { schema, t, type SchemaType } from '@colyseus/schema';

import { InputHandleImpl, type InputHandleHost } from '../src/input/InputHandle.ts';

const MoveInput = schema({
    x: t.number().default(0),
    y: t.number().default(0),
});
type MoveInput = SchemaType<typeof MoveInput>;

interface MockConn {
    isOpen: boolean;
    reliable: Uint8Array[];
    unreliable: Uint8Array[];
}

function mockHost(opts: { clockNow?: () => number; clockRtt?: number; clockSynced?: boolean } = {}): { host: InputHandleHost; conn: MockConn } {
    const conn: MockConn = { isOpen: true, reliable: [], unreliable: [] };
    const host: InputHandleHost = {
        connection: {
            get isOpen() { return conn.isOpen; },
            // Copy on capture — InputHandle reuses its internal scratch buffer
            // across sends, so a stored reference would alias subsequent calls.
            send(data: Uint8Array) { conn.reliable.push(Uint8Array.from(data)); },
            sendUnreliable(data: Uint8Array) { conn.unreliable.push(Uint8Array.from(data)); },
        } as any,
        clock: opts.clockNow ? {
            serverNow: opts.clockNow,
            smoothedRtt: () => opts.clockRtt ?? 0,
            // >0 ⇒ "clock synced" (stamp computed); 0 ⇒ warmup (stamp 0). Synced by default.
            lastServerTime: () => (opts.clockSynced === false ? 0 : 1),
        } : undefined,
    };
    return { host, conn };
}

function makeHandle(
    mode: 'reliable' | 'unreliable',
    opts: {
        delta?: boolean;
        historySize?: number;
        renderTime?: boolean;
        renderDelay?: number;
        tickRate?: number;
        subSteps?: number;
        clockNow?: () => number;
        clockRtt?: number;
        clockSynced?: boolean;
    } = {},
) {
    const { host, conn } = mockHost({ clockNow: opts.clockNow, clockRtt: opts.clockRtt, clockSynced: opts.clockSynced });
    const instance = new MoveInput();
    const encoder = new InputEncoder(instance as any, {
        mode,
        delta: opts.delta,
        historySize: opts.historySize,
    });
    const handle = new InputHandleImpl(host, instance, encoder, {
        renderTime: opts.renderTime,
        renderDelay: opts.renderDelay,
        tickRate: opts.tickRate,
        subSteps: opts.subSteps,
    });
    return { handle, conn, instance };
}

function readU32LE(buf: Uint8Array, offset: number): number {
    return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
}

function readU16LE(buf: Uint8Array, offset: number): number {
    return buf[offset] | (buf[offset + 1] << 8);
}

describe('InputHandle', () => {
    describe('common', () => {
        test('initial state: sentCount and lastProcessed are 0; mode reflects encoder', () => {
            const r = makeHandle('reliable');
            assert.equal(r.handle.mode, 'reliable');
            assert.equal(r.handle.sentCount, 0);
            assert.equal(r.handle.lastProcessed, 0);

            const u = makeHandle('unreliable', { historySize: 3 });
            assert.equal(u.handle.mode, 'unreliable');
            assert.equal(u.handle.sentCount, 0);
            assert.equal(u.handle.lastProcessed, 0);
        });

        test('sub-step getters derive from tickRate/subSteps; default to 1 / step dt', () => {
            const sub = makeHandle('reliable', { tickRate: 30, subSteps: 2 });
            assert.equal(sub.handle.subSteps, 2);
            assert.equal(sub.handle.subStepSeconds, (1 / 30) / 2);
            assert.equal(sub.handle.subStepMs, (1000 / 30) / 2);

            const plain = makeHandle('reliable', { tickRate: 30 });
            assert.equal(plain.handle.subSteps, 1);
            assert.equal(plain.handle.subStepSeconds, plain.handle.stepSeconds, 'degenerates to the full step');

            const noRate = makeHandle('reliable', { subSteps: 2 });
            assert.isUndefined(noRate.handle.subStepSeconds, 'no advertised rate → no derived dt');
            assert.equal(noRate.handle.subSteps, 2);
        });

        test('send() is a no-op when the connection is closed (both modes)', () => {
            const r = makeHandle('reliable');
            r.conn.isOpen = false;
            r.instance.x = 1;
            r.handle.send();
            assert.equal(r.conn.reliable.length, 0);
            assert.equal(r.handle.sentCount, 0);

            const u = makeHandle('unreliable', { historySize: 3 });
            u.conn.isOpen = false;
            u.instance.x = 1;
            u.handle.send();
            assert.equal(u.conn.unreliable.length, 0);
        });
    });

    describe('reliable', () => {
        test('frames payload with ROOM_INPUT_RELIABLE and routes to conn.send', () => {
            const { handle, conn, instance } = makeHandle('reliable');
            instance.x = 7;
            instance.y = 9;
            handle.send();

            assert.equal(conn.reliable.length, 1);
            assert.equal(conn.unreliable.length, 0);
            assert.equal(conn.reliable[0][0], Protocol.ROOM_INPUT_RELIABLE);
            assert.isAbove(conn.reliable[0].length, 1, 'payload bytes follow the opcode');
        });

        test('sentCount increments per non-empty send', () => {
            const { handle, instance } = makeHandle('reliable');
            instance.x = 1; handle.send();
            assert.equal(handle.sentCount, 1);
            instance.x = 2; handle.send();
            assert.equal(handle.sentCount, 2);
            instance.x = 3; handle.send();
            assert.equal(handle.sentCount, 3);
        });

        test('delta no-change emits nothing and does NOT bump sentCount', () => {
            const { handle, conn, instance } = makeHandle('reliable', { delta: true });
            instance.x = 1;
            handle.send(); // first emits a baseline
            assert.equal(handle.sentCount, 1);
            assert.equal(conn.reliable.length, 1);

            // No mutations between sends — encoder returns empty.
            handle.send();
            assert.equal(handle.sentCount, 1, 'no-op send must not advance the seq counter');
            assert.equal(conn.reliable.length, 1);
        });

        test('ackInput advances lastProcessed monotonically and returns RTT >= 0', () => {
            const { handle, instance } = makeHandle('reliable');
            for (let i = 0; i < 3; i++) { instance.x = i; handle.send(); }
            assert.equal(handle.sentCount, 3);

            const rtt2 = handle.ackInput(2);
            assert.isAtLeast(rtt2, 0, 'known seq → real RTT sample');
            assert.equal(handle.lastProcessed, 2);

            // Stale ack: no progress, no sample.
            assert.equal(handle.ackInput(1), -1);
            assert.equal(handle.ackInput(2), -1);
            assert.equal(handle.lastProcessed, 2);

            // Next valid ack still finds its send-time (eviction kept ≥ lastProcessed).
            const rtt3 = handle.ackInput(3);
            assert.isAtLeast(rtt3, 0);
            assert.equal(handle.lastProcessed, 3);
        });

        test('ackInput for a seq without a recorded send-time advances lastProcessed but returns -1', () => {
            const { handle, instance } = makeHandle('reliable');
            instance.x = 1; handle.send();

            // seq 99 was never transmitted — server could only ack it if we
            // sent it, but we treat the input as a no-RTT progress event.
            const rtt = handle.ackInput(99);
            assert.equal(rtt, -1);
            assert.equal(handle.lastProcessed, 99);
        });

        test('send-time table evicts oldest entries past the cap (256)', () => {
            const { handle, instance } = makeHandle('reliable');
            // Drive past the 256-entry cap. Full-mode reliable emits a snapshot
            // every call, so each loop iteration produces a real send.
            for (let i = 0; i < 260; i++) { instance.x = i; handle.send(); }
            assert.equal(handle.sentCount, 260);

            // seq 1 was pushed out when the cap was hit → no send-time → -1.
            assert.equal(handle.ackInput(1), -1);
            assert.equal(handle.lastProcessed, 1);

            // A seq still inside the window has a recorded send-time.
            const rtt = handle.ackInput(260);
            assert.isAtLeast(rtt, 0);
            assert.equal(handle.lastProcessed, 260);
        });

        test('reset() clears sentCount, lastProcessed, and the send-time table', () => {
            const { handle, instance } = makeHandle('reliable');
            instance.x = 1; handle.send();
            instance.x = 2; handle.send();
            handle.ackInput(1);
            assert.equal(handle.sentCount, 2);
            assert.equal(handle.lastProcessed, 1);

            handle.reset();
            assert.equal(handle.sentCount, 0);
            assert.equal(handle.lastProcessed, 0);

            // Stale ack from before reset: no matching send-time, but the
            // counter is monotonic so it still moves forward.
            assert.equal(handle.ackInput(2), -1);
            assert.equal(handle.lastProcessed, 2);
        });

        test('renderTime: ORs TIMED onto opcode and prepends [u32 reckonTime][u16 renderDelta]', () => {
            let t = 1234;
            const { handle, conn, instance } = makeHandle('reliable', {
                renderTime: true,
                renderDelay: 100,
                clockRtt: 60,           // one-way ≈ 30, folded into the delta
                clockNow: () => t,
            });
            instance.x = 1;
            handle.send();

            const buf = conn.reliable[0];
            assert.equal(buf[0], Protocol.ROOM_INPUT_RELIABLE | ProtocolModifier.TIMED);
            assert.equal(readU32LE(buf, 1), 1234, 'base stamp = round(serverNow) — the reckon display instant');
            assert.equal(readU16LE(buf, 5), 130, 'delta = renderDelay + smoothedRtt/2 ⇒ server derives renderTime = 1104');

            // Base stamp stays the raw serverNow even when small; the server's
            // `renderTime = reckonTime − delta` floors at 0, not the client.
            t = 50;
            instance.x = 2;
            handle.send();
            assert.equal(readU32LE(conn.reliable[1], 1), 50);
            assert.equal(readU16LE(conn.reliable[1], 5), 130);
        });

        test('renderTime: stamps 0 until the clock has synced (lastServerTime == 0)', () => {
            const { handle, conn, instance } = makeHandle('reliable', {
                renderTime: true,
                renderDelay: 100,
                clockRtt: 60,
                clockSynced: false,     // no TIMED sample yet
                clockNow: () => 1234,
            });
            instance.x = 1;
            handle.send();

            const buf = conn.reliable[0];
            assert.equal(buf[0], Protocol.ROOM_INPUT_RELIABLE | ProtocolModifier.TIMED);
            assert.equal(readU32LE(buf, 1), 0, 'unsynced → 0 ⇒ server uses live positions');
            assert.equal(readU16LE(buf, 5), 0, 'unsynced → no delta either');
        });
    });

    describe('unreliable', () => {
        test('frames payload with ROOM_INPUT_UNRELIABLE and routes to conn.sendUnreliable', () => {
            const { handle, conn, instance } = makeHandle('unreliable', { historySize: 3 });
            instance.x = 5; handle.send();
            instance.x = 6; handle.send();

            assert.equal(conn.reliable.length, 0);
            assert.equal(conn.unreliable.length, 2);
            assert.equal(conn.unreliable[0][0], Protocol.ROOM_INPUT_UNRELIABLE);
            assert.equal(conn.unreliable[1][0], Protocol.ROOM_INPUT_UNRELIABLE);
        });

        test('does NOT bump sentCount and does NOT record send-times', () => {
            const { handle, instance } = makeHandle('unreliable', { historySize: 3 });
            instance.x = 1; handle.send();
            instance.x = 2; handle.send();
            instance.x = 3; handle.send();

            // Per InputHandle: the redundant ring would double-count and break
            // the seq↔send-time correlation, so unreliable sends are skipped.
            assert.equal(handle.sentCount, 0);

            // No matching send-time exists → ackInput returns -1.
            assert.equal(handle.ackInput(1), -1);
            // ...but lastProcessed still advances (server is authoritative).
            assert.equal(handle.lastProcessed, 1);
        });

        test('renderTime flag is ignored on unreliable sends', () => {
            const { handle, conn, instance } = makeHandle('unreliable', {
                historySize: 3,
                renderTime: true,
                renderDelay: 0,
                clockNow: () => 1000,
            });
            instance.x = 1;
            handle.send();

            // Plain unreliable opcode, no TIMED bit, no 4-byte prefix.
            assert.equal(conn.unreliable[0][0], Protocol.ROOM_INPUT_UNRELIABLE);
        });
    });
});
