import { ITransport, ITransportEventMap } from "./ITransport";
import { encode, decode, Iterator } from '@colyseus/schema';

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
    isOpen: boolean = false;

    reader: ReadableStreamDefaultReader;
    writer: WritableStreamDefaultWriter;

    unreliableReader: ReadableStreamDefaultReader<Uint8Array>;
    unreliableWriter: WritableStreamDefaultWriter<Uint8Array>;

    private lengthPrefixBuffer = new Uint8Array(9); // 9 bytes is the maximum length of a length prefix

    private reliableReassembler = new FrameReassembler();
    private unreliableReassembler = new FrameReassembler();

    constructor(public events: ITransportEventMap) { }

    public connect(url: string, options: any = {}) {
        const wtOpts: WebTransportOptions = options.fingerprint && ({
            // requireUnreliable: true,
            // congestionControl: "default", // "low-latency" || "throughput"

            serverCertificateHashes: [{
                algorithm: 'sha-256',
                value: new Uint8Array(options.fingerprint).buffer
            }]
        }) || undefined;

        this.wt = new WebTransport(url, wtOpts);

        this.wt.ready.then((e) => {
            console.log("WebTransport ready!", e)
            this.isOpen = true;

            this.unreliableReader = this.wt.datagrams.readable.getReader();
            this.unreliableWriter = this.wt.datagrams.writable.getWriter();

            const incomingBidi = this.wt.incomingBidirectionalStreams.getReader();
            incomingBidi.read().then((stream) => {
                this.reader = stream.value.readable.getReader();
                this.writer = stream.value.writable.getWriter();

                // immediately write room/sessionId for establishing the room connection
                this.sendSeatReservation(options.room.roomId, options.sessionId, options.reconnectionToken);

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
        const prefixLength = encode.number(this.lengthPrefixBuffer as any, data.length, { offset: 0 });
        const dataWithPrefixedLength = new Uint8Array(prefixLength + data.length);
        dataWithPrefixedLength.set(this.lengthPrefixBuffer.subarray(0, prefixLength), 0);
        dataWithPrefixedLength.set(data, prefixLength);
        this.writer.write(dataWithPrefixedLength);
    }

    public sendUnreliable(data: Buffer | Uint8Array): void {
        const prefixLength = encode.number(this.lengthPrefixBuffer as any, data.length, { offset: 0 });
        const dataWithPrefixedLength = new Uint8Array(prefixLength + data.length);
        dataWithPrefixedLength.set(this.lengthPrefixBuffer.subarray(0, prefixLength), 0);
        dataWithPrefixedLength.set(data, prefixLength);
        this.unreliableWriter.write(dataWithPrefixedLength);
    }

    public close(code?: number, reason?: string) {
        try {
            this.wt.close({ closeCode: code, reason: reason });
        } catch (e) {
            console.error(e);
        }
    }

    protected async readIncomingData() {
        let result: ReadableStreamReadResult<Uint8Array>;

        while (this.isOpen) {
            try {
                result = await this.reader.read();

                //
                // a single read may contain multiple messages
                // each message is prefixed with its length
                // a read may also deliver a partial frame; buffer across reads
                //
                for (const frame of this.reliableReassembler.push(result.value)) {
                    this.events.onmessage({ data: frame });
                }

            } catch (e) {
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

                //
                // a single read may contain multiple messages
                // each message is prefixed with its length
                // a read may also deliver a partial frame; buffer across reads
                //
                for (const frame of this.unreliableReassembler.push(result.value)) {
                    this.events.onmessage({ data: frame });
                }

            } catch (e) {
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

    protected sendSeatReservation (roomId: string, sessionId: string, reconnectionToken?: string) {
        const it: Iterator = { offset: 0 };
        const bytes: number[] = [];

        encode.string(bytes, roomId, it);
        encode.string(bytes, sessionId, it);

        if (reconnectionToken) {
            encode.string(bytes, reconnectionToken, it);
        }

        this.writer.write(new Uint8Array(bytes).buffer);
    }

    protected _close() {
        this.isOpen = false;
    }

}
