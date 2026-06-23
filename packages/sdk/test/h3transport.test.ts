import { describe, test } from "vitest";
import { assert } from "chai";
import { encode } from "@colyseus/schema";
import { FrameReassembler } from "../src/transport/H3Transport";

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
