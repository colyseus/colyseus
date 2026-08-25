import { describe, test, expectTypeOf, vi } from "vitest";
import { assert } from "chai";

import { NULL_CLOCK, RoomClockImpl, type RoomClock, type RoomClockLike } from "../src/RoomClock.ts";
import type { Room } from "../src/Room.ts";

//
// `Room.clock` presence contract: always a `RoomClock` — every member,
// including `renderNow()`, callable with no optional chaining.
//
describe("RoomClock", () => {

    test("NULL_CLOCK satisfies the full RoomClock contract", () => {
        const c: RoomClock = NULL_CLOCK;
        assert.isNumber(c.renderNow());
        assert.isNumber(c.serverNow());
        assert.isNumber(c.now());
        assert.equal(c.rtt(), 0);
    });

    test("renderNow with slew disabled returns serverNow verbatim", () => {
        // Freeze the clock source: verbatim means the SAME reading, not two
        // wall-clock samples a scheduler hiccup apart.
        const nowSpy = vi.spyOn(performance, "now").mockReturnValue(1234);
        try {
            const clock = new RoomClockImpl();
            clock.setRenderTau(0);
            assert.equal(clock.renderNow(), clock.serverNow());
        } finally {
            nowSpy.mockRestore();
        }
    });

    test("renderNow slews: seeded on first use, idempotent within a frame", () => {
        // Drive the clock source by hand — the same-frame guard is a sub-ms
        // window, too tight to hit reliably off wall-clock reads.
        let t = 1000;
        const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => t);
        try {
            const clock = new RoomClockImpl();
            const first = clock.renderNow();
            assert.closeTo(first, clock.serverNow(), 1);
            t += 0.1; // still within the frame
            assert.equal(clock.renderNow(), first, "same-frame read does not re-advance");
        } finally {
            nowSpy.mockRestore();
        }
    });

    test("type: room.clock guarantees a non-optional renderNow", () => {
        expectTypeOf<Room["clock"]["renderNow"]>().toEqualTypeOf<() => number>();
        // The structural accept-type keeps it optional (bare fakes may omit it).
        expectTypeOf<RoomClockLike["renderNow"]>().toEqualTypeOf<(() => number) | undefined>();
    });
});
