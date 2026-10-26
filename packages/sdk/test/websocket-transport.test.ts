import { describe, test, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { assert } from "chai";
import { CloseCode } from "@colyseus/shared-types";

// a socket whose handshake fails
class FakeWebSocket {
    static OPEN = 1;
    static last: FakeWebSocket;
    static constructed: any[][] = [];
    /** Like a browser: an options object is read as a subprotocol, an invalid one. */
    static rejectsOptions = false;

    readyState = 0;
    binaryType = "blob";
    onopen: ((ev: any) => void) | null = null;
    onmessage: ((ev: any) => void) | null = null;
    onclose: ((ev: any) => void) | null = null;
    onerror: ((ev: any) => void) | null = null;

    constructor(...args: any[]) {
        FakeWebSocket.constructed.push(args);
        if (FakeWebSocket.rejectsOptions && typeof args[1] === "object" && !Array.isArray(args[1])) {
            throw new SyntaxError(`Wrong protocol for WebSocket '${args[1]}'`);
        }
        FakeWebSocket.last = this;
    }
    close() {}
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("WebSocketTransport", () => {
    let WebSocketTransport: typeof import("../src/transport/WebSocketTransport.ts").WebSocketTransport;

    beforeAll(async () => {
        // the transport picks its WebSocket class when the module loads
        vi.stubGlobal("WebSocket", FakeWebSocket);
        vi.resetModules();
        ({ WebSocketTransport } = await import("../src/transport/WebSocketTransport.ts"));
    });

    afterAll(() => { vi.unstubAllGlobals(); });

    function connect() {
        const closes: any[] = [];
        const transport = new WebSocketTransport({ onclose: (event) => closes.push(event) });
        transport.connect("ws://localhost:2567");
        return { socket: FakeWebSocket.last, closes };
    }

    test("closes a socket that failed to open when the runtime fires no close (undici)", async () => {
        const { socket, closes } = connect();

        socket.onerror!({ type: "error" });
        await nextTick();

        assert.deepEqual(closes.map((event) => event.code), [CloseCode.ABNORMAL_CLOSURE]);
    });

    test("closes a socket that failed to open even if an error listener throws", async () => {
        const closes: any[] = [];
        const transport = new WebSocketTransport({
            onerror: () => { throw new Error("onError listener failed"); },
            onclose: (event) => closes.push(event),
        });
        transport.connect("ws://localhost:2567");

        assert.throws(() => FakeWebSocket.last.onerror!({ type: "error" }), "onError listener failed");
        await nextTick();

        assert.deepEqual(closes.map((event) => event.code), [CloseCode.ABNORMAL_CLOSURE]);
    });

    test("forwards a failed handshake's error once, even if a listener closes the socket (undici)", async () => {
        const closes: any[] = [];
        let errors = 0;
        const transport = new WebSocketTransport({
            onerror: () => { errors++; transport.close(); }, // e.g. room.leave(false) from onError
            onclose: (event) => closes.push(event),
        });
        transport.connect("ws://localhost:2567");
        const socket = FakeWebSocket.last;

        // undici fires error again from close() while the socket is still CONNECTING
        let refires = 0;
        socket.close = () => { if (refires++ < 10) { socket.onerror?.({ type: "error" }); } };

        socket.onerror!({ type: "error" });
        await nextTick();

        assert.strictEqual(errors, 1);
        assert.deepEqual(closes.map((event) => event.code), [CloseCode.ABNORMAL_CLOSURE]);
    });

    test("forwards the runtime's own close only once (browsers, ws)", async () => {
        const { socket, closes } = connect();

        const close = { code: CloseCode.ABNORMAL_CLOSURE, reason: "" };
        socket.onerror!({ type: "error" });
        socket.onclose!(close);
        await nextTick();

        assert.strictEqual(closes.length, 1);
        assert.strictEqual(closes[0], close);
    });

    test("close(MAY_TRY_RECONNECT) closes the socket even if a close listener throws", () => {
        const transport = new WebSocketTransport({ onclose: () => { throw new Error("onLeave listener failed"); } });
        transport.connect("ws://localhost:2567");

        const closeCodes: number[] = [];
        FakeWebSocket.last.close = (code?: number) => { closeCodes.push(code); };

        assert.throws(() => transport.close(CloseCode.MAY_TRY_RECONNECT), "onLeave listener failed");
        assert.deepEqual(closeCodes, [CloseCode.MAY_TRY_RECONNECT]);
    });

    describe("constructing the socket", () => {
        beforeEach(() => { FakeWebSocket.constructed = []; });

        afterEach(() => {
            FakeWebSocket.rejectsOptions = false;
            vi.unstubAllGlobals();
            vi.stubGlobal("WebSocket", FakeWebSocket);
        });

        test("in a browser, doesn't probe with an options object (Safari logs the rejected subprotocol)", () => {
            vi.stubGlobal("document", {});
            FakeWebSocket.rejectsOptions = true;

            new WebSocketTransport({}).connect("ws://localhost:2567", {});

            assert.deepEqual(FakeWebSocket.constructed, [["ws://localhost:2567", undefined]]);
        });

        test("outside a browser, passes the headers", () => {
            new WebSocketTransport({}).connect("ws://localhost:2567", { authorization: "x" });

            assert.deepEqual(FakeWebSocket.constructed, [["ws://localhost:2567", { headers: { authorization: "x" }, protocols: undefined }]]);
        });
    });
});
