import './util';
import { describe, test, beforeEach } from "vitest";
import { assert } from "chai";

import { Protocol, ProtocolModifier } from "@colyseus/shared-types";
import { Room } from "../src/index.ts";

//
// `@unreliable` state patches arrive over a datagram, so they can be reordered.
// Every such frame carries a uint16 seq; the client applies a frame only when
// it is newer than the last one it applied, otherwise a late datagram would
// write a stale value that survives until the field changes again.
//
// Drives the protocol dispatch directly with a stub serializer — the reorder
// rule lives above the schema decoder and shouldn't need one to be tested.
//

/** `[ROOM_STATE_PATCH | UNRELIABLE][uint16 seq LE][...body]` */
function unreliablePatch(seq: number, body: number[] = [0]) {
    return Uint8Array.from([
        Protocol.ROOM_STATE_PATCH | ProtocolModifier.UNRELIABLE,
        seq & 0xFF,
        (seq >> 8) & 0xFF,
        ...body,
    ]);
}

/** A plain reliable patch — no modifier, no seq. */
function reliablePatch(body: number[] = [0]) {
    return Uint8Array.from([Protocol.ROOM_STATE_PATCH, ...body]);
}

function fullState(body: number[] = [0]) {
    return Uint8Array.from([Protocol.ROOM_STATE, ...body]);
}

describe("unreliable state patches", () => {
    let room: Room;
    let applied: string[];

    beforeEach(() => {
        room = new Room("game");
        applied = [];

        room['serializer'] = {
            patch: () => { applied.push("patch"); },
            setState: () => { applied.push("setState"); },
            getState: () => ({}),
        } as any;
    });

    const feed = (frame: Uint8Array) => room['onMessageCallback']({ data: frame } as MessageEvent);

    test("applies frames that arrive in order", () => {
        feed(unreliablePatch(1));
        feed(unreliablePatch(2));
        feed(unreliablePatch(3));

        assert.deepEqual(applied, ["patch", "patch", "patch"]);
    });

    test("drops a reordered frame that is older than the newest applied", () => {
        feed(unreliablePatch(1));
        feed(unreliablePatch(3));
        feed(unreliablePatch(2)); // late — 3 already landed

        assert.deepEqual(applied, ["patch", "patch"], "the stale frame must not reach the decoder");
    });

    test("drops an exact duplicate", () => {
        feed(unreliablePatch(4));
        feed(unreliablePatch(4));

        assert.deepEqual(applied, ["patch"]);
    });

    test("treats a wrap past 65535 as newer, not as a 65535-frame regression", () => {
        // Walk the counter up to the boundary the way the server does — each
        // step within the half-range that uint16 wrap arithmetic can order.
        feed(unreliablePatch(30000));
        feed(unreliablePatch(60000));
        feed(unreliablePatch(65535));
        applied.length = 0;

        feed(unreliablePatch(0)); // wrapped
        feed(unreliablePatch(1));

        assert.deepEqual(applied, ["patch", "patch"]);
    });

    test("a full state re-baselines the timeline", () => {
        feed(unreliablePatch(9000));
        applied.length = 0;

        // Rejoin/resync: seqs restart from a fresh server-side counter, and a
        // low seq must not be mistaken for a stale frame.
        feed(fullState());
        feed(unreliablePatch(1));

        assert.deepEqual(applied, ["setState", "patch"]);
    });

    test("never gates the reliable channel on the seq", () => {
        feed(unreliablePatch(500));
        feed(reliablePatch());
        feed(reliablePatch());

        assert.deepEqual(applied, ["patch", "patch", "patch"],
            "reliable patches carry no seq and are always applied");
    });
});
