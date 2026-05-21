/**
 * Request/Response messaging — porting reference
 * ================================================
 *
 * A "request" is an ordinary room message that the *client* opts into getting a
 * reply for. There is NO new server-side API: the server answers a request with
 * the SAME `onMessage(type, ...)` handler it already uses for one-way messages —
 * the handler's RETURN VALUE (awaited) becomes the response payload.
 *
 * The client decides whether it wants a reply:
 *   - `room.send(type, payload)`                  → fire-and-forget (ROOM_DATA, unchanged)
 *   - `room.send(type, payload, callback)`        → request; callback is (response, error?)
 *   - `room.request(type, payload, { timeout? })` → request; returns a Promise/future
 *
 * Passing a callback / calling request() flips the wire from ROOM_DATA to
 * ROOM_REQUEST, which carries a `requestId`. The server echoes that id back in a
 * ROOM_RESPONSE so the client can match the reply to the right pending caller.
 * This is what makes concurrent in-flight requests (even of the same type) safe.
 *
 *
 * WIRE PROTOCOL
 * -------------
 * Two new protocol codes (the rest of the protocol is unchanged):
 *
 *   ROOM_REQUEST  = 21   client → server
 *     [21][requestId varint][type (string|number)][msgpack payload?]
 *
 *   ROOM_RESPONSE = 22   server → client
 *     [22][requestId varint][status uint8][msgpack payload?]
 *       status: 0 = OK, 1 = ERROR
 *
 * Encodings reuse the existing primitives:
 *   - `requestId`  : varint (same `encode.number` / `decode.number` used elsewhere)
 *   - `type`       : string (length-prefixed utf8) OR number (varint) — the
 *                    receiver peeks the next byte (`stringCheck`) to tell which,
 *                    identical to ROOM_DATA's `type` field.
 *   - payload      : msgpack; OMITTED entirely when undefined (sender writes
 *                    nothing after the header; receiver checks "are there bytes
 *                    left?" before unpacking).
 *
 * On an ERROR response the payload is a plain object { name, message, code? }
 * (msgpack map). The client reconstructs a native error/exception from it.
 *
 *
 * SERVER CONTRACT  (already implemented in @colyseus/core — Node only; here for
 * understanding what an SDK can rely on. You do NOT port this unless you are
 * also writing a server in another language.)
 * ------------------------------------------------------------------------------
 * On receiving ROOM_REQUEST the server:
 *   1. decodes requestId, type, payload (running the same validation as ROOM_DATA);
 *   2. finds the FIRST `onMessage(type)` handler (wildcard "*" handlers do NOT
 *      count — a type with only a "*" handler replies with a `no_handler` error);
 *   3. invokes it and treats the return value as the response:
 *        - resolves to a value  → ROOM_RESPONSE status=OK,    payload=value
 *        - returns undefined     → ROOM_RESPONSE status=OK,    no payload
 *        - throws / rejects      → ROOM_RESPONSE status=ERROR, payload={name,message,code?}
 *        - no handler registered → ROOM_RESPONSE status=ERROR, payload={name:"no_handler",...}
 *   4. a malformed payload replies with an ERROR but does NOT drop the client
 *      (unlike a one-way ROOM_DATA, which disconnects on a decode/validation error).
 *
 * The server never allocates state for a request — it just echoes `requestId`.
 * If the client has already disconnected, the reply is silently dropped.
 *
 *
 * CLIENT SDK  (THIS IS WHAT YOU PORT)
 * -----------------------------------
 * State to add to the Room:
 *   - a default timeout (ms) for a reply, overridable per-call;
 *   - a monotonic request-id counter (wrap within uint32);
 *   - a map of in-flight requests: requestId → { resolve, reject, timer }.
 *
 * Behaviour to implement:
 *   - encode/send ROOM_REQUEST and register a pending entry with a timeout;
 *   - on ROOM_RESPONSE, look up the pending entry, clear its timer, and
 *     resolve (OK) or reject (ERROR) it; ignore unknown/already-settled ids;
 *   - on connection close, reject ALL pending requests (the reply can never
 *     arrive on a dead socket) — including on a drop that will auto-reconnect,
 *     since the in-flight request was bound to the old socket.
 *
 * NOTE: there is intentionally no client-side "does the server support this?"
 * check. Against a server too old to understand ROOM_REQUEST, the request simply
 * times out and rejects after `requestTimeout`.
 */

enum Protocol {
  ROOM_DATA = 13,
  ROOM_REQUEST = 21,
  ROOM_RESPONSE = 22,
}

enum ResponseStatus {
  OK = 0,
  ERROR = 1,
}

export class Room {
    /**
     * Default time (ms) a request waits for a reply before rejecting.
     * Override per-call via the `timeout` option on request().
     */
    public requestTimeout: number = 10000;

    /** Monotonic id correlating a ROOM_REQUEST with its ROOM_RESPONSE. */
    #nextRequestId: number = 0;

    /** In-flight requests awaiting a ROOM_RESPONSE. */
    #pendingRequests = new Map<number, {
        resolve: (value: any) => void;
        reject: (reason: any) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * `send` gains an optional third argument. When a callback is provided the
     * message becomes a request and the callback receives (response, error?).
     * Without it, behaviour is the existing one-way ROOM_DATA send (unchanged).
     */
    public send(messageType: string | number, payload?: any, callback?: (response: any, error?: Error) => void): void {
        if (callback !== undefined) {
            this.#request(messageType, payload, this.requestTimeout).then(
                (response) => callback(response, undefined),
                (error) => callback(undefined, error),
            );
            return;
        }

        // ---- existing one-way ROOM_DATA send (shown for context) ----
        const it = { offset: 1 };
        this.packr.buffer[0] = Protocol.ROOM_DATA;
        this.#encodeType(messageType, it);
        this.packr.position = 0;
        const data = (payload !== undefined)
            ? this.packr.pack(payload, 2048 + it.offset) // 2048 = RESERVE_START_SPACE
            : this.packr.buffer.subarray(0, it.offset);
        if (!this.connection.isOpen) {
            enqueueMessage(this, new Uint8Array(data));
        } else {
            this.connection.send(data);
        }
    }

    /**
     * Send a message and await the server's reply. The server answers by
     * returning a value from its matching `onMessage(type, ...)` handler.
     *
     * Rejects if the handler throws, if no handler is registered, if the
     * connection closes first, or if no reply arrives within `timeout`.
     */
    public request(messageType: string | number, payload?: any, options?: { timeout?: number }): Promise<any> {
        return this.#request(messageType, payload, options?.timeout ?? this.requestTimeout);
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    #request(messageType: string | number, payload: any, timeoutMs: number): Promise<any> {
        return new Promise((resolve, reject) => {
            // A reply can only come back over a live socket.
            if (!this.connection.isOpen) {
                reject(new Error(`cannot send request "${messageType}": connection is not open.`));
                return;
            }

            const requestId = this.#nextRequestId;
            this.#nextRequestId = (this.#nextRequestId + 1) >>> 0; // keep within uint32

            // encode: [ROOM_REQUEST][requestId][type][payload?]
            const it = { offset: 1 };
            this.packr.buffer[0] = Protocol.ROOM_REQUEST;
            encode.number(this.packr.buffer, requestId, it);
            this.#encodeType(messageType, it);

            this.packr.position = 0;
            const data = (payload !== undefined)
                ? this.packr.pack(payload, 2048 + it.offset) // 2048 = RESERVE_START_SPACE
                : this.packr.buffer.subarray(0, it.offset);

            const timer = setTimeout(() => {
                this.#pendingRequests.delete(requestId);
                reject(new Error(`request "${messageType}" timed out after ${timeoutMs}ms.`));
            }, timeoutMs);

            this.#pendingRequests.set(requestId, { resolve, reject, timer });
            this.connection.send(data);
        });
    }

    /** Reject every in-flight request — called when the socket closes. */
    #rejectAllPending(reason: string) {
        if (this.#pendingRequests.size === 0) { return; }
        const error = new Error(reason);
        for (const pending of this.#pendingRequests.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.#pendingRequests.clear();
    }

    /** Shared helper: write the message `type` as string or number. */
    #encodeType(messageType: string | number, it: { offset: number }) {
        if (typeof (messageType) === "string") {
            encode.string(this.packr.buffer, messageType, it);
        } else {
            encode.number(this.packr.buffer, messageType, it);
        }
    }

    // -------------------------------------------------------------------------
    // Receive — add a ROOM_RESPONSE branch to the message dispatcher
    // -------------------------------------------------------------------------

    protected onMessageCallback(event: MessageEvent) {
        const buffer = new Uint8Array(event.data);
        const it = { offset: 1 };
        const code = buffer[0];

        // ... existing branches: JOIN_ROOM, ERROR, ROOM_STATE, ROOM_DATA, etc.

        if (code === Protocol.ROOM_RESPONSE) {
            const requestId = decode.number(buffer, it);
            const status = buffer[it.offset++];

            const pending = this.#pendingRequests.get(requestId);
            // already settled (e.g. timed out) or unknown id — ignore
            if (pending !== undefined) {
                this.#pendingRequests.delete(requestId);
                clearTimeout(pending.timer);

                const payload = (buffer.byteLength > it.offset)
                    ? unpack(buffer, { start: it.offset })
                    : undefined;

                if (status === ResponseStatus.OK) {
                    pending.resolve(payload);
                } else {
                    // payload carries { name, message, code } from the server
                    const error: any = new Error(payload?.message ?? "request failed");
                    if (payload?.name) { error.name = payload.name; }
                    if (payload?.code !== undefined) { error.code = payload.code; }
                    pending.reject(error);
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Wire #rejectAllPending into the connection-close path
    // -------------------------------------------------------------------------

    public connect(endpoint: string, options?: any, headers?: any) {
        this.connection = new Connection(options.protocol);
        this.connection.events.onmessage = this.onMessageCallback.bind(this);
        this.connection.events.onclose = (e: CloseEvent) => {
            // the in-flight requests can't be answered on a closed socket
            this.#rejectAllPending("connection closed before a response was received.");

            // ... existing close handling (reconnection / onLeave) ...
        };
    }
}
