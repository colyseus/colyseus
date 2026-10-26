import { describe, test, beforeAll, afterAll, vi } from "vitest";
import { assert } from "chai";
import { CloseCode } from "@colyseus/shared-types";

// a socket whose handshake fails
class FakeWebSocket {
    static OPEN = 1;
    static last: FakeWebSocket;

    readyState = 0;
    binaryType = "blob";
    onopen: ((ev: any) => void) | null = null;
    onmessage: ((ev: any) => void) | null = null;
    onclose: ((ev: any) => void) | null = null;
    onerror: ((ev: any) => void) | null = null;

    constructor() { FakeWebSocket.last = this; }
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

    test("forwards the runtime's own close only once (browsers, ws)", async () => {
        const { socket, closes } = connect();

        const close = { code: CloseCode.ABNORMAL_CLOSURE, reason: "" };
        socket.onerror!({ type: "error" });
        socket.onclose!(close);
        await nextTick();

        assert.strictEqual(closes.length, 1);
        assert.strictEqual(closes[0], close);
    });
});
