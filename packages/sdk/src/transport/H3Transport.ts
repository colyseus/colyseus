import { encode, decode, type Iterator } from '@colyseus/schema';
import type { ITransport, ITransportEventMap } from "./ITransport.ts";

export class H3TransportTransport implements ITransport {
    wt: WebTransport;
    isOpen: boolean = false;
    events: ITransportEventMap;

    reader: ReadableStreamDefaultReader;
    writer: WritableStreamDefaultWriter;

    unreliableReader: ReadableStreamDefaultReader<Uint8Array>;
    unreliableWriter: WritableStreamDefaultWriter<Uint8Array>;

    private lengthPrefixBuffer = new Uint8Array(9); // 9 bytes is the maximum length of a length prefix

    constructor(events: ITransportEventMap) {
        this.events = events;
    }

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
                //

                const messages = result.value;
                const it: Iterator = { offset: 0 };
                do {
                    //
                    // QUESTION: should we buffer the message in case it's not fully read?
                    //

                    const length = decode.number(messages as any, it);
                    this.events.onmessage({ data: messages.subarray(it.offset, it.offset + length) });
                    it.offset += length;
                } while (it.offset < messages.length);

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
                //

                const messages = result.value;
                const it: Iterator = { offset: 0 };
                do {
                    //
                    // QUESTION: should we buffer the message in case it's not fully read?
                    //

                    const length = decode.number(messages as any, it);
                    this.events.onmessage({ data: messages.subarray(it.offset, it.offset + length) });
                    it.offset += length;
                } while (it.offset < messages.length);

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
