import { encode, decode, type Iterator } from '@colyseus/schema';
import type { ITransport, ITransportEventMap } from "./ITransport.ts";

// 9 bytes is the maximum length of a variable-length integer prefix
const MAX_LENGTH_PREFIX_BYTES = 9;

/**
 * Reassembles length-prefixed frames from arbitrary byte chunks.
 *
 * A single WebTransport `reader.read()` may:
 *   - deliver multiple whole frames in one chunk
 *   - split a frame (or its length prefix) across multiple chunks
 *
 * This reassembler buffers partial data across reads so each dispatched
 * frame is exactly one complete message.
 */
export class FrameReassembler {
    private pending: Uint8Array = new Uint8Array(0);

    push(chunk: Uint8Array | undefined): Uint8Array[] {
        if (!chunk || chunk.byteLength === 0) { return []; }

        const bytes = (this.pending.byteLength === 0)
            ? chunk
            : concatBytes(this.pending, chunk);

        const frames: Uint8Array[] = [];
        let offset = 0;

        while (offset < bytes.byteLength) {
            const it: Iterator = { offset };
            let length: number;

            try {
                length = decode.number(bytes as any, it);
            } catch (e) {
                // length prefix is incomplete — wait for more bytes
                if (bytes.byteLength - offset <= MAX_LENGTH_PREFIX_BYTES) { break; }
                throw e;
            }

            const frameEnd = it.offset + length;
            if (frameEnd > bytes.byteLength) {
                // payload is incomplete — wait for more bytes
                break;
            }

            frames.push(bytes.subarray(it.offset, frameEnd));
            offset = frameEnd;
        }

        this.pending = (offset < bytes.byteLength)
            ? bytes.slice(offset)
            : new Uint8Array(0);

        return frames;
    }
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.byteLength + b.byteLength);
    out.set(a, 0);
    out.set(b, a.byteLength);
    return out;
}

export class H3TransportTransport implements ITransport {
    wt: WebTransport;
    /** Connect URL — exposed so tooling (e.g. the debug panel) can show the
     *  endpoint, mirroring `WebSocketTransport.ws.url`. */
    url?: string;
    isOpen: boolean = false;
    events: ITransportEventMap;

    reader: ReadableStreamDefaultReader;
    writer: WritableStreamDefaultWriter;

    unreliableReader: ReadableStreamDefaultReader<Uint8Array>;
    unreliableWriter: WritableStreamDefaultWriter<Uint8Array>;

    private lengthPrefixBuffer = new Uint8Array(9); // 9 bytes is the maximum length of a length prefix

    private reliableReassembler = new FrameReassembler();
    private unreliableReassembler = new FrameReassembler();

    constructor(events: ITransportEventMap) {
        this.events = events;
    }

    public connect(url: string, options: any = {}) {
        this.url = url;
        const wtOpts: WebTransportOptions = options.fingerprint && ({
            // requireUnreliable: true,
            // congestionControl: "default", // "low-latency" || "throughput"

            serverCertificateHashes: [{
                algorithm: 'sha-256',
                // Pass the Uint8Array VIEW, not `.buffer`: the @fails-components Node client
                // (1.6) rejects a raw ArrayBuffer here, silently failing the cert-hash match
                // → "Opening handshake failed". Browsers accept either; Node wants the view.
                value: new Uint8Array(options.fingerprint)
            }]
        }) || undefined;

        this.wt = new WebTransport(url, wtOpts);

        this.wt.ready.then((e) => {
            console.log("WebTransport ready!", e)
            this.isOpen = true;

            this.unreliableReader = this.wt.datagrams.readable.getReader();
            // Datagram writer differs by runtime: the browser's native WebTransport
            // exposes `datagrams.writable` (a WritableStream); @fails-components/webtransport
            // 1.6 (Node) deprecates that in favor of `createWritable()`. Prefer the method
            // when present (silences the Node deprecation), else the standard property.
            const datagrams = this.wt.datagrams as any;
            this.unreliableWriter = (datagrams.createWritable ? datagrams.createWritable() : datagrams.writable).getWriter();

            const incomingBidi = this.wt.incomingBidirectionalStreams.getReader();
            incomingBidi.read().then((stream) => {
                this.reader = stream.value.readable.getReader();
                this.writer = stream.value.writable.getWriter();

                // immediately write room/sessionId for establishing the room connection
                this.sendSeatReservation(options.roomId, options.sessionId, options.reconnectionToken, options.skipHandshake);

                // start reading incoming data
                this.readIncomingData();
                this.readIncomingUnreliableData();

            }).catch((e) => {
                console.error("failed to read incoming stream", e);
                console.error("TODO: close the connection");
            });

            // this.events.onopen(e);
        }).catch((e: WebTransportCloseInfo) => {
            // this.events.onerror(e);
            // this.events.onclose({ code: e.closeCode, reason: e.reason });
            console.log("WebTransport not ready!", e)
            this._close();
        });

        this.wt.closed.then((e: WebTransportCloseInfo) => {
            console.log("WebTransport closed w/ success", e)
            this.events.onclose({ code: e.closeCode, reason: e.reason });

        }).catch((e: WebTransportCloseInfo) => {
            console.log("WebTransport closed w/ error", e)
            this.events.onerror(e);
            this.events.onclose({ code: e.closeCode, reason: e.reason });
        }).finally(() => {
            this._close();
        });
    }

    public send(data: Buffer | Uint8Array): void {
        this.writer.write(this.frame(data));
    }

    public sendUnreliable(data: Buffer | Uint8Array): void {
        this.unreliableWriter.write(this.frame(data));
    }

    /**
     * Length-prefix a payload for the wire. Normalizes the input to a typed array
     * first: unlike `ws.send()` (which accepts an ArrayBuffer directly), we frame
     * manually — reading `.length` and copying via `.set()` — so a bare ArrayBuffer
     * (e.g. the debug panel's latency-sim clone) must be wrapped, or `.length` is
     * `undefined` and the allocation/copy goes out of bounds.
     */
    protected frame(data: Buffer | Uint8Array | ArrayBuffer): Uint8Array {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
        const prefixLength = encode.number(this.lengthPrefixBuffer as any, bytes.length, { offset: 0 });
        const out = new Uint8Array(prefixLength + bytes.length);
        out.set(this.lengthPrefixBuffer.subarray(0, prefixLength), 0);
        out.set(bytes, prefixLength);
        return out;
    }

    public close(code?: number, reason?: string) {
        this.isOpen = false; // stop the reader loops; mark closed before tearing down
        try {
            // close() is void in the browser but can reject async (e.g. "session is
            // closed" when already closing/closed) in some impls — swallow both the
            // sync throw and any rejected promise so it doesn't surface as uncaught.
            const ret = this.wt?.close({ closeCode: code, reason: reason }) as unknown as Promise<void> | void;
            if (ret && typeof (ret as Promise<void>).catch === "function") {
                (ret as Promise<void>).catch(() => { /* already closed — benign */ });
            }
        } catch (e) {
            /* already closed / invalid state — benign during a simulated drop */
        }
    }

    protected async readIncomingData() {
        let result: ReadableStreamReadResult<Uint8Array>;

        while (this.isOpen) {
            try {
                result = await this.reader.read();

                // Stream ended (close/drop): a `done` read has no `value` — bail
                // before decoding, or `decode.number(undefined)` throws on teardown.
                if (result.done || !result.value) { break; }

                //
                // a single read may contain multiple messages
                // each message is prefixed with its length
                // a read may also deliver a partial frame; buffer across reads
                //
                for (const frame of this.reliableReassembler.push(result.value)) {
                    this.events.onmessage({ data: frame });
                }

            } catch (e: any) {
                if (e.message.indexOf("session is closed") === -1) {
                    console.error("H3Transport: failed to read incoming data", e);
                }
                break;
            }

            if (result.done) {
                break;
            }
        }
    }

    protected async readIncomingUnreliableData() {
        let result: ReadableStreamReadResult<Uint8Array>;

        while (this.isOpen) {
            try {
                result = await this.unreliableReader.read();

                // Stream ended (close/drop): a `done` read has no `value` — bail
                // before decoding, or `decode.number(undefined)` throws on teardown.
                if (result.done || !result.value) { break; }

                //
                // a single read may contain multiple messages
                // each message is prefixed with its length
                // a read may also deliver a partial frame; buffer across reads
                //
                for (const frame of this.unreliableReassembler.push(result.value)) {
                    this.events.onmessage({ data: frame });
                }

            } catch (e: any) {
                if (e.message.indexOf("session is closed") === -1) {
                    console.error("H3Transport: failed to read incoming data", e);
                }
                break;
            }

            if (result.done) {
                break;
            }
        }
    }

    protected sendSeatReservation (roomId: string, sessionId: string, reconnectionToken?: string, skipHandshake?: boolean) {
        const it: Iterator = { offset: 0 };
        const bytes: number[] = [];

        encode.string(bytes, roomId, it);
        encode.string(bytes, sessionId, it);

        if (reconnectionToken) {
            encode.string(bytes, reconnectionToken, it);
        }

        if (skipHandshake) {
            encode.boolean(bytes, 1, it);
        }

        this.writer.write(new Uint8Array(bytes).buffer);
    }

    protected _close() {
        this.isOpen = false;
    }

}
