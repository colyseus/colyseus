import './util';
import { afterEach, describe, test, vi } from "vitest";
import assert from "assert";
import { setItem, getItem } from "../src/Storage";

describe("Storage", function() {

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test("get and set", () => {
        setItem("test", "test");

        let getCalled = false;
        getItem("test", (data) => {
            getCalled = true;
            assert.strictEqual(data, "test");
        })

        assert.ok(getCalled);
    });

    test("storage denied to an opaque origin fails silently", async () => {
        // a sandboxed document without allow-same-origin: both APIs throw SecurityError
        const denied = () => { throw new DOMException("denied", "SecurityError"); };
        vi.stubGlobal("window", { get localStorage() { return denied(); } });
        vi.stubGlobal("indexedDB", { open: denied });
        vi.resetModules();

        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", onUnhandled);

        try {
            const storage = await import("../src/Storage");

            let getCalled = false;
            storage.getItem("token", () => getCalled = true);
            storage.setItem("token", "value");
            storage.removeItem("token");

            await new Promise((resolve) => setImmediate(resolve));

            assert.deepStrictEqual(unhandled, []);
            // nothing to restore; a token assigned meanwhile must survive
            assert.strictEqual(getCalled, false);

        } finally {
            process.off("unhandledRejection", onUnhandled);
        }
    });

    test("a full storage doesn't fail the write", async () => {
        const full = () => { throw new DOMException("full", "QuotaExceededError"); };
        vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: full } });
        vi.resetModules();

        const storage = await import("../src/Storage");
        assert.doesNotThrow(() => storage.setItem("token", "value"));
    });

});
