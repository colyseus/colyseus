import { decode, Iterator, Reflection } from '@colyseus/schema';
import { InputEncoder } from '@colyseus/schema/input';
import { InputFlags } from '@colyseus/shared-types';

import { InputHandleImpl, type InputHandle, type InputOptions } from './InputHandle.ts';
import { NULL_CLOCK, RoomClock } from '../RoomClock.ts';

// Type-only: avoids a runtime import cycle (Room imports RoomInput as a value).
import type { Room } from '../Room.ts';

/**
 * Owns all per-room input state, kept off the {@link Room} class itself: the
 * schema constructor recovered from the JOIN handshake, the server-advertised
 * stamp/rate flags, and the lazily-created {@link InputHandle}.
 *
 * Created lazily by {@link Room} only when the room declares input (an
 * `INPUT_*` handshake section arrives) or the app calls `room.input(...)`.
 * Rooms that never use input (chat / lobby / turn-based) never allocate one.
 * @internal
 */
export class RoomInput {
    #room: Room;

    // Impl type (not the public interface) so the TIMED decode can feed it the
    // server ack via the internal `ackInput()`.
    #handle?: InputHandleImpl<any>;

    /**
     * Schema constructor recovered via Reflection from the server's handshake
     * (the `INPUT_REFLECTION` tagged section). Falls back to `undefined` when
     * the server room didn't call `defineInput()`.
     *
     * Typed as `new () => any` (not `Schema`) on purpose — pinning to this
     * SDK's Schema type would clash with user instances coming from a
     * different copy of `@colyseus/schema` under multi-version installs.
     */
    #ctorFromReflection?: new () => any;

    /** `true` when the handshake advertised the SNAPSHOT-timeline stamp
     *  (`INPUT_OPTIONS`, `InputFlags.RENDER_TIME`). */
    #stampRender = false;

    /** `true` when the handshake advertised the RECKON-timeline stamp
     *  (`INPUT_OPTIONS`, `InputFlags.RECKON_TIME`). Set together with
     *  {@link #stampRender} ⇒ the 6-byte `[reckonTime][renderDelta]` prefix. */
    #stampReckon = false;

    /** Server-advertised fixed simulation/input step rate (Hz) from
     *  `defineInput({ tickRate })`. */
    #tickRate?: number;

    /** Server-advertised state-patch interval (ms) = the reconcile cadence. */
    #patchRate?: number;

    /** Server-advertised physics sub-steps per input tick
     *  (`setFixedTimestep(..., { subSteps })`). */
    #subSteps?: number;

    constructor(room: Room) {
        this.#room = room;
    }

    /** Snapshot cadence (ms), so {@link Room} can feed `clock.setPatchInterval`. */
    get patchRate(): number | undefined {
        return this.#patchRate;
    }

    /**
     * Decode the `INPUT_REFLECTION` handshake section: install schema-builder
     * field descriptors on the reconstructed class so {@link InputEncoder} can
     * read its `$values` and emit non-empty packets, then cache the ctor.
     *
     * INPUT_REFLECTION is also the signal that the server called `defineInput()`
     * and will emit TIMED-prefixed state messages — so swap the default stub
     * clock for a real {@link RoomClock} unless the user already replaced
     * `room.clock` with their own. Advances `it`.
     */
    applyReflection(buffer: Uint8Array, it: Iterator, sectionEnd: number): void {
        const inputDecoder = Reflection.decode(buffer.subarray(0, sectionEnd) as any, it);
        Reflection.makeEncodable(inputDecoder.state.constructor as any);
        this.#ctorFromReflection = inputDecoder.state.constructor as new () => any;

        if (this.#room.clock === NULL_CLOCK) this.#room.clock = new RoomClock();
    }

    /**
     * Decode the `INPUT_OPTIONS` handshake section.
     * `[flags uint8][tickRate varint?][patchRate varint?][subSteps varint?]`,
     * varints in bit order. Advances `it`.
     */
    applyOptions(buffer: Uint8Array, it: Iterator): void {
        const flags = buffer[it.offset++];
        this.#stampRender = (flags & InputFlags.RENDER_TIME) !== 0;
        this.#stampReckon = (flags & InputFlags.RECKON_TIME) !== 0;
        if (flags & InputFlags.FIXED_TIMESTEP) this.#tickRate = decode.number(buffer as Buffer, it);
        if (flags & InputFlags.PATCH_RATE) this.#patchRate = decode.number(buffer as Buffer, it);
        if (flags & InputFlags.SUB_STEPS) this.#subSteps = decode.number(buffer as Buffer, it);
    }

    /** Feed the server's last-processed input seq to the handle; returns the RTT
     *  sample (or `-1` before the handle exists / when the seq aged out). */
    ackInput(inputSeq: number): number {
        return this.#handle ? this.#handle.ackInput(inputSeq) : -1;
    }

    /** Reset the input round-trip on reconnect (see {@link Room} reconnection). */
    reset(): void {
        this.#handle?.reset();
    }

    /**
     * Lazily create and cache the per-room {@link InputHandle}; subsequent calls
     * return the same handle (options on later calls are ignored). Backs
     * `room.input(...)` — see that method for the full discovery/usage docs.
     */
    handle<I>(options?: InputOptions<I>): InputHandle<I> {
        if (this.#handle) {
            return this.#handle as InputHandle<I>;
        }

        const Ctor = (options?.type ?? this.#ctorFromReflection) as (new () => I) | undefined;
        if (!Ctor) {
            throw new Error(
                "conn.input(): no input schema available. The server room must call " +
                "`defineInput(YourInput)`, or you can pass `{ type: YourInput }` explicitly."
            );
        }

        const instance = new Ctor();
        // The InputEncoder always delta-encodes (no full-snapshot mode), so
        // there's nothing to configure here beyond mode/historySize.
        const encoder = new InputEncoder(instance as any, options);
        // The handle owns the input round-trip (send counter, RTT send-times, server-acked count);
        // the TIMED decode feeds it the ack and it produces RTT samples for the clock (see Room.onMessage).
        // `stampRender`/`stampReckon` are server-driven (INPUT_OPTIONS flags); `renderDelay` lets the app subtract its interp buffer.
        this.#handle = new InputHandleImpl(this.#room, instance, encoder, {
            stampRender: this.#stampRender,
            stampReckon: this.#stampReckon,
            renderDelay: options?.renderDelay,
            allowRewind: options?.allowRewind,   // app gate: skip the stamp on inputs the server won't rewind
            tickRate: this.#tickRate,
            patchRate: this.#patchRate,
            subSteps: this.#subSteps,
        });
        return this.#handle as InputHandle<I>;
    }
}
