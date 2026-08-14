import './util';
import { describe, test } from 'vitest';
import { assert } from 'chai';

import { Protocol, ProtocolModifier } from '@colyseus/shared-types';
import { InputEncoder } from '@colyseus/schema/input';
import { schema, t, decode, type SchemaType } from '@colyseus/schema';

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

function mockHost(opts: { clockNow?: () => number; clockRtt?: number | (() => number); clockSynced?: boolean } = {}): { host: InputHandleHost; conn: MockConn } {
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
            smoothedRtt: () => (typeof opts.clockRtt === 'function' ? opts.clockRtt() : opts.clockRtt) ?? 0,
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
        stampRender?: boolean;
        stampReckon?: boolean;
        renderDelay?: number;
        tickRate?: number;
        subSteps?: number;
        allowRewind?: (data: MoveInput) => boolean;
        clockNow?: () => number;
        clockRtt?: number | (() => number);
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
        stampRender: opts.stampRender,
        stampReckon: opts.stampReckon,
        renderDelay: opts.renderDelay,
        tickRate: opts.tickRate,
        subSteps: opts.subSteps,
        allowRewind: opts.allowRewind,
    });
    return { handle, conn, instance };
}

// Mirror the server's reconstruction of the DELTA-CODED stamp: add the signed
// wire delta (self-describing number codec) to the running baseline. `both` ⇒ a
// trailing absolute u16 renderDelta. `bodyAt` is where the input body begins.
function readStamp(buf: Uint8Array, baseline: number, both = false): { value: number; renderDelta: number; bodyAt: number } {
    const it = { offset: 1 };
    const value = baseline + decode.number(buf as any, it);
    const renderDelta = both ? decode.uint16(buf as any, it) : 0;
    return { value, renderDelta, bodyAt: it.offset };
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

        test('delta no-change emits a body-less frame and bumps sentCount', () => {
            const { handle, conn, instance } = makeHandle('reliable', { delta: true });
            instance.x = 1;
            handle.send(); // first emits a baseline (has body)
            assert.equal(handle.sentCount, 1);
            assert.equal(conn.reliable.length, 1);
            assert.isAbove(conn.reliable[0].length, 1, 'baseline carries payload bytes');

            // No mutations between sends — encoder returns empty, but we still
            // transmit a body-less frame so the server gets one input per send().
            handle.send();
            assert.equal(handle.sentCount, 2, 'every send advances the seq counter');
            assert.equal(conn.reliable.length, 2);
            assert.equal(conn.reliable[1].length, 1, 'body-less: opcode only, no payload');
            assert.equal(conn.reliable[1][0], Protocol.ROOM_INPUT_RELIABLE);
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

        test('send-time ring evicts oldest entries past the seq window', () => {
            const { handle, instance } = makeHandle('reliable');
            // Drive well past the ring size (shared with the replay ring; 90
            // slots when no rates are advertised). Full-mode reliable emits a
            // snapshot every call, so each loop iteration produces a real send.
            for (let i = 0; i < 260; i++) { instance.x = i; handle.send(); }
            assert.equal(handle.sentCount, 260);

            // seq 1 aged out of the window → no send-time → -1.
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
            assert.equal(handle.epoch, 0, 'epoch untouched by sends/acks');

            handle.reset();
            assert.equal(handle.sentCount, 0);
            assert.equal(handle.lastProcessed, 0);
            assert.equal(handle.epoch, 1, 'every reset bumps the epoch');
            handle.reset();
            assert.equal(handle.epoch, 2);

            // Stale ack from before reset: no matching send-time, but the
            // counter is monotonic so it still moves forward.
            assert.equal(handle.ackInput(2), -1);
            assert.equal(handle.lastProcessed, 2);
        });

        test('BOTH stamps: ORs TIMED onto opcode and prepends [varint Δreckon][u16 renderDelta], reconstructed against the baseline', () => {
            let t = 1234;
            const { handle, conn, instance } = makeHandle('reliable', {
                stampRender: true,
                stampReckon: true,
                renderDelay: 100,
                clockRtt: 60,           // one-way ≈ 30, folded into the delta
                clockNow: () => t,
            });
            instance.x = 1;
            handle.send();

            const buf = conn.reliable[0];
            assert.equal(buf[0], Protocol.ROOM_INPUT_RELIABLE | ProtocolModifier.TIMED);
            const s0 = readStamp(buf, 0, true);   // baseline 0 → first delta is absolute
            assert.equal(s0.value, 1234, 'reckonTime = round(serverNow) — the reckon display instant');
            assert.equal(s0.renderDelta, 130, 'delta = renderDelay + smoothedRtt/2 ⇒ server derives renderTime = 1104');
            assert.equal(buf.length, s0.bodyAt + bodyLen(1), 'opcode + varint stamp + u16 delta + body');

            // A backward jump in serverNow ships a NEGATIVE delta; the baseline still
            // reconstructs the raw value (the server floors renderTime, not the client).
            t = 50;
            instance.x = 2;
            handle.send();
            const s1 = readStamp(conn.reliable[1], 1234, true);   // baseline = the previous stamp
            assert.equal(s1.value, 50);
            assert.equal(s1.renderDelta, 130);
        });

        test('bindRenderDelay: an unset renderDelay is driven by the bound provider (the Predict lerp delay)', () => {
            const { handle, conn, instance } = makeHandle('reliable', {
                stampRender: true,
                stampReckon: true,
                // no renderDelay → not explicit, so the binding takes effect
                clockRtt: 60,           // one-way ≈ 30
                clockNow: () => 1234,
            });
            handle.bindRenderDelay(() => 100);
            instance.x = 1;
            handle.send();
            assert.equal(readStamp(conn.reliable[0], 0, true).renderDelta, 130, 'delta = boundDelay(100) + rtt/2(30)');
        });

        test('bindRenderDelay: an explicit room.input({ renderDelay }) wins over the binding', () => {
            const { handle, conn, instance } = makeHandle('reliable', {
                stampRender: true,
                stampReckon: true,
                renderDelay: 100,       // explicit
                clockRtt: 60,
                clockNow: () => 1234,
            });
            handle.bindRenderDelay(() => 999);   // ignored — explicit wins
            instance.x = 1;
            handle.send();
            assert.equal(readStamp(conn.reliable[0], 0, true).renderDelta, 130, 'still 100 + rtt/2, binding ignored');
        });

        test('bindRenderDelay: provider is read each send, so a live delay change tracks (no drift)', () => {
            let delay = 100;
            const { handle, conn, instance } = makeHandle('reliable', {
                stampRender: true,
                stampReckon: true,
                clockRtt: 60,
                clockNow: () => 1234,
            });
            handle.bindRenderDelay(() => delay);
            instance.x = 1;
            handle.send();
            assert.equal(readStamp(conn.reliable[0], 0, true).renderDelta, 130, '100 + 30');
            delay = 40;
            instance.x = 2;
            handle.send();
            // baseline = the previous stamp (serverNow is constant → a 0 delta this send).
            assert.equal(readStamp(conn.reliable[1], 1234, true).renderDelta, 70, 'tracks the live change: 40 + 30');
        });

        // Length of the encoded MoveInput body (no opcode, no prefix) for `x`,
        // so prefix-length assertions don't hard-code schema framing bytes.
        function bodyLen(x: number): number {
            const r = makeHandle('reliable', { clockNow: () => 0 });
            r.instance.x = x;
            r.handle.send();
            return r.conn.reliable[0].length - 1;   // minus the opcode byte
        }

        test('RECKON-only: prepends [varint Δreckon], reconstructed (no renderDelta)', () => {
            const { handle, conn, instance } = makeHandle('reliable', {
                stampReckon: true,
                renderDelay: 100,
                clockRtt: 60,
                clockNow: () => 1234,
            });
            instance.x = 1;
            handle.send();

            const buf = conn.reliable[0];
            assert.equal(buf[0], Protocol.ROOM_INPUT_RELIABLE | ProtocolModifier.TIMED);
            const s = readStamp(buf, 0);
            assert.equal(s.value, 1234, 'reckonTime = round(serverNow), shipped directly (immune to rtt error)');
            assert.equal(buf.length, s.bodyAt + bodyLen(1), 'opcode + varint stamp + body (no u16 delta)');
        });

        test('RENDER-only: prepends [varint Δrender] = reckonTime − (renderDelay + rtt/2)', () => {
            const { handle, conn, instance } = makeHandle('reliable', {
                stampRender: true,
                renderDelay: 100,
                clockRtt: 60,           // one-way ≈ 30 → delta 130
                clockNow: () => 1234,
            });
            instance.x = 1;
            handle.send();

            const buf = conn.reliable[0];
            assert.equal(buf[0], Protocol.ROOM_INPUT_RELIABLE | ProtocolModifier.TIMED);
            const s = readStamp(buf, 0);
            assert.equal(s.value, 1104, 'renderTime = 1234 − 130 shipped directly (server reads it as-is)');
            assert.equal(buf.length, s.bodyAt + bodyLen(1), 'opcode + varint stamp + body (no u16 delta)');
        });

        test('RENDER-only: floors at 0 when the delta exceeds the base', () => {
            const { handle, conn, instance } = makeHandle('reliable', {
                stampRender: true,
                renderDelay: 100,
                clockRtt: 60,
                clockNow: () => 50,     // 50 − 130 < 0
            });
            instance.x = 1;
            handle.send();
            assert.equal(readStamp(conn.reliable[0], 0).value, 0, 'renderTime floors at 0');
        });

        test('stamps 0 until the clock has synced (lastServerTime == 0)', () => {
            const { handle, conn, instance } = makeHandle('reliable', {
                stampRender: true,
                stampReckon: true,
                renderDelay: 100,
                clockRtt: 60,
                clockSynced: false,     // no TIMED sample yet
                clockNow: () => 1234,
            });
            instance.x = 1;
            handle.send();

            const buf = conn.reliable[0];
            assert.equal(buf[0], Protocol.ROOM_INPUT_RELIABLE | ProtocolModifier.TIMED);
            const s = readStamp(buf, 0, true);
            assert.equal(s.value, 0, 'unsynced → 0 ⇒ server uses live positions');
            assert.equal(s.renderDelta, 0, 'unsynced → no delta either');
        });

        test('reckon stamp is delta-coded: first send carries the absolute, steady sends ship a 1-byte delta', () => {
            let t = 10_000;
            const { handle, conn, instance } = makeHandle('reliable', {
                stampReckon: true,
                clockNow: () => t,
            });

            instance.x = 1;
            handle.send();
            const first = readStamp(conn.reliable[0], 0);   // baseline 0 → absolute
            assert.equal(first.value, 10_000, 'first stamp is the absolute reckonTime');
            assert.isAbove(first.bodyAt, 2, 'absolute needs a multi-byte varint');

            // Each ~one-step advance ships a single signed byte that reconstructs
            // the absolute against the running baseline — the idle-bandwidth win.
            let baseline = first.value;
            for (let i = 1; i <= 3; i++) {
                t += 42;                            // ≈ one 24 Hz step
                instance.x = i + 1;
                handle.send();
                const s = readStamp(conn.reliable[i], baseline);
                assert.equal(s.value, t, 'reconstructs the absolute reckonTime');
                assert.equal(s.bodyAt, 2, 'steady-state stamp is one byte (opcode + 1)');
                baseline = s.value;
            }
        });

        test('allowRewind: gates the stamp per send — unstamped frames drop TIMED, baseline reconstructs across the gap', () => {
            let t = 1000;
            const { handle, conn, instance } = makeHandle('reliable', {
                stampRender: true,
                clockNow: () => t,
                allowRewind: (d) => d.x >= 10,   // "firing" frames only
            });

            // x < 10 → no stamp: plain opcode, no TIMED, no prefix.
            instance.x = 5; handle.send();
            assert.equal(conn.reliable[0][0], Protocol.ROOM_INPUT_RELIABLE, 'unstamped: plain opcode');
            assert.equal(conn.reliable[0][0] & ProtocolModifier.TIMED, 0, 'unstamped: TIMED clear');

            // x ≥ 10 → stamp at t=1000: TIMED set, baseline 0 → absolute renderTime.
            instance.x = 10; handle.send();
            assert.equal(conn.reliable[1][0], Protocol.ROOM_INPUT_RELIABLE | ProtocolModifier.TIMED, 'stamped: TIMED set');
            assert.equal(readStamp(conn.reliable[1], 0).value, 1000, 'first stamp = absolute renderTime');

            // Clock advances while UNSTAMPED — the baseline must stay frozen at 1000.
            t = 1050; instance.x = 5; handle.send();
            assert.equal(conn.reliable[2][0] & ProtocolModifier.TIMED, 0, 'still unstamped across the gap');

            // Next stamped frame at t=1100: its delta is from the last STAMPED (1000),
            // not the skipped 1050 — so the server (baseline 1000) reconstructs 1100.
            t = 1100; instance.x = 20; handle.send();
            assert.equal(readStamp(conn.reliable[3], 1000).value, 1100, 'reconstructs across the unstamped gap');
        });

        test('no stamp flags: plain reliable opcode, no TIMED bit, no prefix', () => {
            const { handle, conn, instance } = makeHandle('reliable', { clockNow: () => 1234 });
            instance.x = 1;
            handle.send();
            const buf = conn.reliable[0];
            assert.equal(buf[0], Protocol.ROOM_INPUT_RELIABLE, 'no TIMED modifier');
            assert.equal((buf[0] & ProtocolModifier.TIMED), 0, 'TIMED bit clear ⇒ no stamp prefix');
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

        test('bumps sentCount to the framework seq and populates the replay ring + send-times', () => {
            const { handle, instance } = makeHandle('unreliable', { historySize: 3 });
            instance.x = 1; handle.send();
            instance.x = 2; handle.send();
            instance.x = 3; handle.send();

            // Unreliable now mirrors reliable's reconciler state, keyed by the
            // encoder's framework seq (one per tick — push-every-tick).
            assert.equal(handle.sentCount, 3);

            // Replay ring is populated — at() returns the buffered snapshot for an
            // unacked seq, so a reconciler can replay it.
            assert.isDefined(handle.at(3));
            assert.equal((handle.at(3) as any).x, 3);

            // Send-times recorded → ackInput finds them and returns a real RTT.
            const rtt = handle.ackInput(2);
            assert.isAtLeast(rtt, 0);
            assert.equal(handle.lastProcessed, 2);
            assert.equal(handle.pendingCount, 1); // sentCount 3 − lastProcessed 2
        });

        test('seq-value ack prunes straight past lost-then-recovered seqs (pending stays exact)', () => {
            const { handle, instance } = makeHandle('unreliable', { historySize: 3 });
            for (let i = 1; i <= 5; i++) { instance.x = i; handle.send(); }
            assert.equal(handle.sentCount, 5);

            // The server acks the seq VALUE of the last consumed input. Even if seq 4's
            // own packet dropped (recovered via the ring), the ack jumps to 5 — pending
            // drains to 0 rather than lagging by the lost count (the count-vs-value fix).
            handle.ackInput(5);
            assert.equal(handle.lastProcessed, 5);
            assert.equal(handle.pendingCount, 0);
        });

        test('stamps every ring slot in a self-contained block', () => {
            const { handle, conn, instance } = makeHandle('unreliable', {
                historySize: 3,
                stampReckon: true,
                renderDelay: 0,
                clockNow: () => 1000,
            });

            instance.x = 1; handle.send();
            instance.x = 2; handle.send();
            instance.x = 3; handle.send();

            const packet = conn.unreliable[2];
            assert.equal(packet[0], Protocol.ROOM_INPUT_UNRELIABLE | ProtocolModifier.TIMED,
                'TIMED rides the unreliable opcode too');

            // [varint k][uint32 newest][varint Δ]×(k−1) — one stamp per slot, so
            // a packet is readable without any cross-packet baseline.
            const it = { offset: 1 };
            const k = decode.number(packet as any, it);
            assert.equal(k, 3, 'the block covers every slot the ring carries');

            const stamps: number[] = new Array(k);
            stamps[k - 1] = decode.uint32(packet as any, it);
            for (let i = k - 2; i >= 0; i--) {
                stamps[i] = stamps[i + 1] - decode.number(packet as any, it);
            }
            // Frozen clock ⇒ every slot stamps the same instant; the point is
            // that all three are present and reconstruct exactly.
            assert.deepEqual(stamps, [1000, 1000, 1000]);
        });

        test('BOTH mode: renderDelta is per-slot, not the newest value smeared across the ring', () => {
            let rtt = 20;
            const { handle, conn, instance } = makeHandle('unreliable', {
                historySize: 3,
                stampReckon: true,
                stampRender: true,
                renderDelay: 0,
                clockNow: () => 1000,
                clockRtt: () => rtt,
            });

            // renderDelta = renderDelay + smoothedRtt/2 → 10, 20, 30.
            instance.x = 1; handle.send();
            rtt = 40; instance.x = 2; handle.send();
            rtt = 60; instance.x = 3; handle.send();

            const packet = conn.unreliable[2];
            const it = { offset: 1 };
            const k = decode.number(packet as any, it);
            assert.equal(k, 3);

            // Skip the timeline series (anchor + k−1 deltas).
            decode.uint32(packet as any, it);
            for (let i = 0; i < k - 1; i++) { decode.number(packet as any, it); }

            const rds: number[] = new Array(k);
            rds[k - 1] = decode.uint16(packet as any, it);
            for (let i = k - 2; i >= 0; i--) {
                rds[i] = rds[i + 1] - decode.number(packet as any, it);
            }
            assert.deepEqual(rds, [10, 20, 30],
                'each slot keeps the latency term it was sampled with');
        });

        test('BOTH mode: a steady renderDelta costs one byte per redundant slot', () => {
            const mk = (both: boolean) => {
                const { handle, conn, instance } = makeHandle('unreliable', {
                    historySize: 4,
                    stampReckon: true,
                    stampRender: both,
                    renderDelay: 0,
                    clockNow: () => 1000,
                    clockRtt: 40,
                });
                for (let i = 1; i <= 4; i++) { instance.x = i; handle.send(); }
                return conn.unreliable[3].length;
            };
            // Same body either way; the delta is the renderDelta series: a u16
            // anchor plus 3 one-byte deltas (all zero here) = 5 bytes.
            assert.equal(mk(true) - mk(false), 5);
        });

        test('allowRewind is ignored, and says so once', () => {
            const warnings: string[] = [];
            const realWarn = console.warn;
            console.warn = (...a: any[]) => { warnings.push(String(a[0])); };
            try {
                // Reliable is where the option means something — stay quiet there.
                makeHandle('reliable', { stampReckon: true, allowRewind: () => true });
                assert.equal(warnings.length, 0, 'no warning on the channel that honours it');

                (InputHandleImpl as any)._warnedAllowRewindIgnored = false;
                makeHandle('unreliable', { historySize: 3, stampReckon: true, allowRewind: () => true });
                makeHandle('unreliable', { historySize: 3, stampReckon: true, allowRewind: () => true });

                assert.equal(warnings.length, 1, 'warns once per process, not per handle');
                assert.match(warnings[0], /allowRewind` is ignored/);
            } finally {
                console.warn = realWarn;
            }
        });

        test('allowRewind does not apply — the ring is stamped all-or-nothing', () => {
            let asked = 0;
            const { handle, conn, instance } = makeHandle('unreliable', {
                historySize: 3,
                stampReckon: true,
                clockNow: () => 1000,
                allowRewind: () => { asked++; return false; },
            });

            instance.x = 1; handle.send();
            instance.x = 2; handle.send();

            assert.equal(asked, 0, 'the predicate is not even evaluated on this channel');

            const packet = conn.unreliable[1];
            assert.equal(packet[0], Protocol.ROOM_INPUT_UNRELIABLE | ProtocolModifier.TIMED);

            const it = { offset: 1 };
            const k = decode.number(packet as any, it);
            const stamps: number[] = new Array(k);
            stamps[k - 1] = decode.uint32(packet as any, it);
            for (let i = k - 2; i >= 0; i--) {
                stamps[i] = stamps[i + 1] - decode.number(packet as any, it);
            }
            assert.deepEqual(stamps, [1000, 1000],
                'every slot carries a real stamp — none zeroed out');
        });

        test('the block shrinks to the slots the ring actually holds', () => {
            const { handle, conn, instance } = makeHandle('unreliable', {
                historySize: 4,
                stampReckon: true,
                clockNow: () => 500,
            });

            instance.x = 1; handle.send();
            const it = { offset: 1 };
            assert.equal(decode.number(conn.unreliable[0] as any, it), 1,
                'first send carries one slot, not historySize');
        });

        test('reset() re-bases the block, since the encoder drops its ring but keeps the seq', () => {
            const { handle, conn, instance } = makeHandle('unreliable', {
                historySize: 4,
                stampReckon: true,
                clockNow: () => 500,
            });

            for (let i = 1; i <= 4; i++) { instance.x = i; handle.send(); }
            handle.reset();
            instance.x = 9; handle.send();

            // Deriving k from the (monotonic) seq would claim 4 slots here.
            const it = { offset: 1 };
            assert.equal(decode.number(conn.unreliable[conn.unreliable.length - 1] as any, it), 1);
        });
    });
});
