import { describe, test, beforeAll, afterAll, vi } from "vitest";
import { assert } from "chai";
import { CloseCode } from "@colyseus/shared-types";

describe("Connection", () => {
    let Connection: typeof import("../src/Connection.ts").Connection;
    let goOffline: () => void;

    beforeAll(async () => {
        // the "offline" listener is installed when the module loads, only where addEventListener is global (browsers)
        vi.stubGlobal("addEventListener", (type: string, listener: () => void) => {
            if (type === "offline") { goOffline = listener; }
        });
        vi.stubGlobal("removeEventListener", () => {});
        vi.resetModules();
        ({ Connection } = await import("../src/Connection.ts"));
    });

    afterAll(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    // the socket's events are fired by hand
    function connect() {
        const connection = new Connection();
        const closeCodes: number[] = [];
        connection.transport = {
            isOpen: false,
            connect() {},
            send() {},
            sendUnreliable() {},
            close: (code?: number) => {
                closeCodes.push(code);
                // as WebSocketTransport: reported right away, which unregisters the offline listener
                if (code === CloseCode.MAY_TRY_RECONNECT) { connection.events.onclose!({ code }); }
            },
        };
        connection.connect("ws://localhost:2567");
        return { connection, closeCodes };
    }

    test("a socket that closes without opening keeps the other connections' offline listeners", () => {
        const open = connect();
        open.connection.events.onopen!({});

        const failed = connect();
        failed.connection.events.onclose!({ code: CloseCode.ABNORMAL_CLOSURE });

        vi.spyOn(console, "warn").mockImplementation(() => {});
        goOffline();

        assert.deepEqual(open.closeCodes, [CloseCode.MAY_TRY_RECONNECT]);
    });

    test("going offline closes every open connection", () => {
        const open = [connect(), connect(), connect()];
        open.forEach(({ connection }) => connection.events.onopen!({}));

        vi.spyOn(console, "warn").mockImplementation(() => {});
        goOffline();

        assert.deepEqual(open.map(({ closeCodes }) => closeCodes), [
            [CloseCode.MAY_TRY_RECONNECT],
            [CloseCode.MAY_TRY_RECONNECT],
            [CloseCode.MAY_TRY_RECONNECT],
        ]);
    });
});
