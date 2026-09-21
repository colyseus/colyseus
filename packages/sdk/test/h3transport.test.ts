import { describe, test, beforeEach, afterEach, vi } from "vitest";
import { assert } from "chai";
import { encode } from "@colyseus/schema";
import { CloseCode } from "@colyseus/shared-types";
import { FrameReassembler, H3TransportTransport } from "../src/transport/H3Transport";

function frame(payload: Uint8Array): Uint8Array {
    const prefixBuf = new Uint8Array(9);
    const prefixLen = encode.number(prefixBuf as any, payload.length, { offset: 0 });
    const out = new Uint8Array(prefixLen + payload.length);
    out.set(prefixBuf.subarray(0, prefixLen), 0);
    out.set(payload, prefixLen);
    return out;
}

function concat(...arrs: Uint8Array[]): Uint8Array {
    const total = arrs.reduce((s, a) => s + a.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrs) { out.set(a, offset); offset += a.byteLength; }
    return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.byteLength !== b.byteLength) { return false; }
    for (let i = 0; i < a.byteLength; i++) { if (a[i] !== b[i]) { return false; } }
    return true;
}

describe("H3Transport FrameReassembler", function () {

    test("dispatches a single whole frame", () => {
        const r = new FrameReassembler();
        const payload = new Uint8Array([10, 1, 2, 3]);
        const frames = r.push(frame(payload));
        assert.equal(frames.length, 1);
        assert.isTrue(bytesEqual(frames[0], payload));
    });

    test("dispatches multiple whole frames in one chunk", () => {
        const r = new FrameReassembler();
        const a = new Uint8Array([10, 1]);
        const b = new Uint8Array([11, 2, 3]);
        const c = new Uint8Array([12, 4, 5, 6]);
        const frames = r.push(concat(frame(a), frame(b), frame(c)));
        assert.equal(frames.length, 3);
        assert.isTrue(bytesEqual(frames[0], a));
        assert.isTrue(bytesEqual(frames[1], b));
        assert.isTrue(bytesEqual(frames[2], c));
    });

    test("buffers a frame split across two reads", () => {
        const r = new FrameReassembler();
        const payload = new Uint8Array([10, 1, 2, 3, 4, 5]);
        const full = frame(payload);
        const mid = Math.floor(full.byteLength / 2);

        const first = r.push(full.subarray(0, mid));
        assert.equal(first.length, 0, "no frame should dispatch before full payload");

        const second = r.push(full.subarray(mid));
        assert.equal(second.length, 1);
        assert.isTrue(bytesEqual(second[0], payload));
    });

    test("buffers a multi-byte length prefix split across reads", () => {
        const r = new FrameReassembler();
        const big = new Uint8Array(500); // forces multi-byte varint prefix
        for (let i = 0; i < big.byteLength; i++) { big[i] = i & 0xff; }
        const full = frame(big);

        // split inside the length prefix (varint for 500 takes 3 bytes)
        const first = r.push(full.subarray(0, 1));
        assert.equal(first.length, 0);

        const second = r.push(full.subarray(1, 2));
        assert.equal(second.length, 0);

        const third = r.push(full.subarray(2));
        assert.equal(third.length, 1);
        assert.isTrue(bytesEqual(third[0], big));
    });

    test("handles mixed whole and partial frames across reads", () => {
        const r = new FrameReassembler();
        const a = new Uint8Array([1, 2, 3]);
        const b = new Uint8Array([4, 5, 6, 7, 8]);
        const c = new Uint8Array([9, 10]);

        const combined = concat(frame(a), frame(b), frame(c));
        const split = Math.floor(combined.byteLength * 0.6);

        const first = r.push(combined.subarray(0, split));
        const second = r.push(combined.subarray(split));

        const allFrames = [...first, ...second];
        assert.equal(allFrames.length, 3);
        assert.isTrue(bytesEqual(allFrames[0], a));
        assert.isTrue(bytesEqual(allFrames[1], b));
        assert.isTrue(bytesEqual(allFrames[2], c));
    });

    test("ignores empty chunks", () => {
        const r = new FrameReassembler();
        assert.equal(r.push(undefined).length, 0);
        assert.equal(r.push(new Uint8Array(0)).length, 0);
    });

});

/** A real `ReadableStream` — an errored one stays errored, as the transport sees it. */
function controllableStream() {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
    return {
        reader: stream.getReader(),
        push: (payload: Uint8Array) => controller.enqueue(frame(payload)),
        fail: (reason: any) => controller.error(reason),
        end: () => controller.close(),
    };
}

/** Lets every pending read/close turn settle, for asserting that nothing happened. */
async function settle() {
    for (let i = 0; i < 4; i++) { await new Promise((resolve) => setTimeout(resolve, 0)); }
}

function connected() {
    const events: any = {};
    const messages: Uint8Array[] = [];
    events.onmessage = (e: any) => messages.push(e.data);

    const transport = new H3TransportTransport(events) as any;
    const reliable = controllableStream();
    const unreliable = controllableStream();

    const closeCalls: any[] = [];
    let resolveDropped: () => void;
    const dropped = new Promise<void>((resolve) => { resolveDropped = resolve; });

    transport.wt = { close: (info: any) => { closeCalls.push(info); resolveDropped(); } };
    transport.reader = reliable.reader;
    transport.unreliableReader = unreliable.reader;
    transport.isOpen = true;

    transport.readIncomingData();
    transport.readIncomingUnreliableData();

    return { transport, reliable, unreliable, messages, closeCalls, dropped };
}

/**
 * A read loop that dies on a rejected `read()` leaves the transport reporting
 * `isOpen === true` while no frame can ever arrive again — the room never sees
 * a drop, so it never reconnects. https://github.com/colyseus/colyseus/issues/975
 */
describe("H3Transport read loops", function () {

    let error: ReturnType<typeof vi.spyOn>;

    beforeEach(() => { error = vi.spyOn(console, "error").mockImplementation(() => {}); });
    afterEach(() => { error.mockRestore(); });

    test("delivers frames on both channels while open", async () => {
        const { reliable, unreliable, messages } = connected();

        reliable.push(new Uint8Array([1, 1]));
        unreliable.push(new Uint8Array([2, 2]));
        await settle();

        assert.equal(messages.length, 2);
    });

    test("drops the connection when the reliable channel fails mid-session", async () => {
        const { transport, reliable, closeCalls, dropped } = connected();

        reliable.fail(new Error("stream reset"));
        await dropped;

        assert.isFalse(transport.isOpen, "transport must not keep reporting itself open");
        assert.equal(closeCalls.length, 1, "the session should be closed so the room reconnects");
        assert.equal(closeCalls[0].closeCode, CloseCode.ABNORMAL_CLOSURE);
        assert.equal(error.mock.calls.length, 1, "the failure must not be swallowed");
    });

    test("drops the connection when the unreliable channel fails mid-session", async () => {
        const { transport, unreliable, closeCalls, dropped } = connected();

        unreliable.fail(new Error("datagram hiccup"));
        await dropped;

        assert.isFalse(transport.isOpen);
        assert.equal(closeCalls.length, 1);
        assert.equal(error.mock.calls.length, 1);
    });

    test("does not retry a rejected read (an errored stream stays errored)", async () => {
        const { transport, reliable, dropped } = connected();

        const read = transport.reader.read.bind(transport.reader);
        let retries = 0;
        transport.reader.read = () => { retries++; return read(); };

        reliable.fail(new Error("gone"));
        await dropped;
        await settle();

        assert.equal(retries, 0, "retrying an errored stream would spin on the same rejection");
    });

    test("stays quiet when the streams error because the session is closing", async () => {
        const { transport, reliable, unreliable, closeCalls } = connected();

        // a teardown marks the transport closed first, then the streams error
        transport.close(CloseCode.CONSENTED, "bye");
        reliable.fail(new Error("session is closed"));
        unreliable.fail(new Error("session is closed"));
        await settle();

        assert.equal(error.mock.calls.length, 0, "an ordinary disconnect must not log");
        assert.equal(closeCalls.length, 1, "no redundant close");
    });

    test("ends a loop on a clean stream end without closing the session", async () => {
        const { reliable, unreliable, closeCalls } = connected();

        reliable.end();
        unreliable.end();
        await settle();

        assert.equal(error.mock.calls.length, 0);
        assert.equal(closeCalls.length, 0, "a `done` read is the session's own teardown, not a failure");
    });

});
