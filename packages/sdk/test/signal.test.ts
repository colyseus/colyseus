import './util';
import { describe, test } from "vitest";
import { assert } from "chai";
import { createSignal } from "../src/core/signal.ts";
import { Room } from "../src/index.ts";

describe("createSignal", () => {
    describe("invoke", () => {
        test("calls every handler in registration order with all arguments", () => {
            const signal = createSignal<(a: number, b: string) => void>();
            const calls: any[] = [];
            signal((a, b) => calls.push(["first", a, b]));
            signal((a, b) => calls.push(["second", a, b]));

            signal.invoke(1, "x");
            assert.deepEqual(calls, [["first", 1, "x"], ["second", 1, "x"]]);
        });

        test("removing a handler during invoke doesn't skip the others", () => {
            const signal = createSignal();
            const calls: string[] = [];
            const a = () => { calls.push("a"); signal.remove(a); };
            signal(a);
            signal(() => calls.push("b"));
            signal(() => calls.push("c"));

            signal.invoke();
            signal.invoke();
            assert.deepEqual(calls, ["a", "b", "c", "b", "c"]);
        });

        test("a handler removed during invoke still runs in that invoke", () => {
            const signal = createSignal();
            const calls: string[] = [];
            const b = () => calls.push("b");
            signal(() => { calls.push("a"); signal.remove(b); });
            signal(b);

            signal.invoke();
            signal.invoke();
            assert.deepEqual(calls, ["a", "b", "a"]);
        });

        test("a handler added during invoke runs from the next invoke", () => {
            const signal = createSignal();
            const calls: string[] = [];
            signal.once(() => { calls.push("a"); signal(() => calls.push("late")); });

            signal.invoke();
            signal.invoke();
            assert.deepEqual(calls, ["a", "late"]);
        });
    });

    describe("remove", () => {
        test("is a no-op for a handler that isn't registered", () => {
            const signal = createSignal();
            const calls: string[] = [];
            const stale = () => calls.push("stale");
            signal(stale);
            signal.clear();
            signal(() => calls.push("after clear"));

            signal.remove(stale);
            signal.invoke();
            assert.deepEqual(calls, ["after clear"]);
        });

        test("drops one registration of a handler added twice", () => {
            const signal = createSignal();
            let count = 0;
            const cb = () => count++;
            signal(cb);
            signal(cb);

            signal.remove(cb);
            signal.invoke();
            assert.equal(count, 1);
        });

        test("removes a handler registered with once(cb)", () => {
            const signal = createSignal();
            const calls: string[] = [];
            const cb = () => calls.push("once");
            signal.once(cb);
            signal(() => calls.push("other"));

            signal.remove(cb);
            signal.invoke();
            assert.deepEqual(calls, ["other"]);
        });
    });

    describe("once", () => {
        test("fires on the next invoke only, with its arguments", () => {
            const signal = createSignal<(code: number) => void>();
            const codes: number[] = [];
            signal.once((code) => codes.push(code));

            signal.invoke(1000);
            signal.invoke(4000);
            assert.deepEqual(codes, [1000]);
        });

        test("doesn't skip the last handler when it isn't last itself", () => {
            const signal = createSignal();
            const calls: string[] = [];
            signal.once(() => calls.push("once"));
            signal(() => calls.push("x"));
            signal(() => calls.push("y"));

            signal.invoke();
            signal.invoke();
            assert.deepEqual(calls, ["once", "x", "y", "x", "y"]);
        });

        test("is removed even if it throws", () => {
            const signal = createSignal();
            let count = 0;
            signal.once(() => { count++; throw new Error("boom"); });

            assert.throws(() => signal.invoke(), "boom");
            signal.invoke();
            assert.equal(count, 1);
        });

        test("re-invoking the signal from it runs it only once", () => {
            const signal = createSignal();
            let count = 0;
            signal.once(() => { count++; signal.invoke(); });

            signal.invoke();
            assert.equal(count, 1);
        });
    });

    describe("clear", () => {
        test("removes every handler, including once() handlers", () => {
            const signal = createSignal();
            let count = 0;
            signal(() => count++);
            signal.once(() => count++);

            signal.clear();
            signal.invoke();
            assert.equal(count, 0);
        });

        test("clearing during invoke still runs the rest of that invoke", () => {
            const signal = createSignal();
            const calls: string[] = [];
            signal(() => { calls.push("a"); signal.clear(); });
            signal(() => calls.push("b"));

            signal.invoke();
            signal.invoke();
            assert.deepEqual(calls, ["a", "b"]);
        });
    });

    describe("invokeAsync", () => {
        test("resolves with each handler's result in order, awaiting async ones", async () => {
            const signal = createSignal<(x: number) => any>();
            signal(async (x) => { await new Promise((r) => setTimeout(r, 5)); return x + 1; });
            signal((x) => x * 2);

            assert.deepEqual(await signal.invokeAsync(10), [11, 20]);
        });

        test("doesn't skip a handler when another removes itself", async () => {
            const signal = createSignal<() => Promise<any>>();
            const calls: string[] = [];
            const a = async () => { calls.push("a"); signal.remove(a); };
            signal(a);
            signal(async () => { calls.push("b"); });
            signal(async () => { calls.push("c"); });

            await signal.invokeAsync();
            assert.deepEqual(calls, ["a", "b", "c"]);
        });
    });
});

describe("Room signals", () => {
    test("onLeave handlers run although the room clears its listeners on leave", () => {
        const room = new Room("chat");
        const codes: number[] = [];
        room.onLeave((code) => codes.push(code));

        room.onLeave.invoke(1000);
        room.onLeave.invoke(1000);
        assert.deepEqual(codes, [1000]);
    });

    test("removing a pre-leave handler after leave keeps handlers added since", () => {
        const room = new Room("chat");
        const stale = () => {};
        room.onDrop(stale);
        room.onLeave.invoke(1000);

        const calls: string[] = [];
        room.onDrop(() => calls.push("after leave"));
        room.onDrop.remove(stale);
        room.onDrop.invoke(1006);
        assert.deepEqual(calls, ["after leave"]);
    });
});
