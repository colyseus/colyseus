import { decode, encode, Encoder, Reflection, type Iterator } from '@colyseus/schema';
import { InputDecoder } from '@colyseus/schema/input';
import { HandshakeSection, InputFlags, ProtocolModifier } from '@colyseus/shared-types';

import {
  InputAccessorImpl, InputBufferImpl, NO_OP_INPUT_ACCESSOR,
  compileSanitizer, validateSubSteps,
} from './InputBuffer.ts';
import type {
  InputAccessor, InputAPI, NormalizedInputOptions,
  DefineInputOptions, IdleDeclared,
} from './types.ts';
import type { Client, ClientPrivate } from '../Transport.ts';
import type { Room } from '../Room.ts';
import { debugAndPrintError } from '../Debug.ts';

/**
 * Module-level cache of `Reflection.encode` output keyed by input
 * constructor — pays the encoding cost once per Room class regardless of
 * room instance count. WeakMap so unused classes can be GC'd.
 */
const _inputReflectionCache = new WeakMap<Function, Uint8Array>();

/**
 * Runtime behind {@link InputAPI}. A class, not a per-`define()` object literal:
 * literal (and `defineProperty`) accessors carry their closure identity in the
 * hidden class, so every room instance would get a UNIQUE map — sending shared
 * `this.inputs.*` call sites megamorphic. Prototype getters are created once,
 * every instance shares one hidden class (reads stay monomorphic), and
 * `define()` allocates a single 1-field object instead of 7 closures + a map
 * lineage per room.
 *
 * @internal
 */
class InputAPIImpl {
  private input: RoomInput;
  constructor(input: RoomInput) { this.input = input; }
  /** Registry, not room.clients: an accessor outlives its client through the
   *  reconnection window, so a dropped seat still synthesizes the idle policy. */
  get(sessionId: string): InputAccessor<any> {
    return this.input.accessors.get(sessionId) ?? NO_OP_INPUT_ACCESSOR;
  }
  // Live reads off `options` (mutated in place by a later setTimestep/
  // setFixedTimestep back-fill, so a derived tickRate is reflected); 1/hz is
  // correctly-rounded IEEE-754 → bit-identical to the client's stepSeconds.
  get tickRate(): number | undefined { return this.input.options.tickRate; }
  get stepSeconds(): number | undefined { const hz = this.input.options.tickRate; return hz ? 1 / hz : undefined; }
  get stepMs(): number | undefined { const hz = this.input.options.tickRate; return hz ? 1000 / hz : undefined; }
  // Sub-step trio: same derivation as the client handle ((1/hz)/n) — bit-identical dt.
  get subSteps(): number { return this.input.options.subSteps ?? 1; }
  get subStepSeconds(): number | undefined { const hz = this.input.options.tickRate; return hz ? (1 / hz) / (this.input.options.subSteps ?? 1) : undefined; }
  get subStepMs(): number | undefined { const hz = this.input.options.tickRate; return hz ? (1000 / hz) / (this.input.options.subSteps ?? 1) : undefined; }
}

/**
 * Per-room input subsystem, owned by {@link Room} and created lazily on the
 * first {@link Room.defineInput} call — rooms without inputs allocate none of
 * it. Owns the input options, the per-session accessor registry (decoupled
 * from `this.clients` so an entry outlives a dropped client across its
 * reconnection window), the wire stamp mode, and the encode/decode/handshake
 * machinery. Reads back into its Room for context it doesn't own (the patch
 * rate and the rewind timeline mode).
 *
 * @internal
 */
export class RoomInput {
  /** Owning room — for `patchRate` and the rewind timeline mode. */
  private room: Room<any>;

  /** Input configuration (ctor, seqField, bufferMaxSize, idle, sanitize,
   *  tickRate, subSteps). `tickRate`/`subSteps` may be back-filled by
   *  `setTimestep`/`setFixedTimestep`. Set in {@link define}. */
  options!: NormalizedInputOptions;

  /** The `InputAPI` returned to userland from `defineInput`, also the
   *  framework-owned handle the rewind binding resolves accessors through. */
  api!: InputAPI<any>;

  /** sessionId → accessor. Decoupled from `this.clients`: an entry outlives its
   *  client across the reconnection window, so {@link InputAPI.get} keeps
   *  synthesizing the idle policy for an absent seat (its buffer was cleared on
   *  leave → idle). Set on join, deleted on full leave. Read by
   *  {@link InputAPIImpl.get} (hence not `private`). */
  readonly accessors: Map<string, InputAccessor<any>> = new Map();

  // Wire stamp mode derived from the rewind timeline, resolved once on first
  // handshake/decode then frozen so advertise + decode never disagree mid-session:
  // the renderTime/reckonTime prefix per input.
  #stampRender = false;
  #stampReckon = false;
  #stampResolved = false;

  constructor(room: Room<any>) {
    this.room = room;
  }

  /**
   * Build the input configuration + `InputAPI` (the body of
   * {@link Room.defineInput}). Returns the api; the Room hands it back to
   * userland and keeps the framework-owned reference.
   */
  define<
    C extends new () => any,
    O extends DefineInputOptions<InstanceType<C>> = DefineInputOptions<InstanceType<C>>,
  >(
    type: C,
    opts?: O,
  ): InputAPI<InstanceType<C>, IdleDeclared<O, InstanceType<C>>> {
    // Normalize the step declaration to the canonical wire form (Hz). stepSeconds
    // / stepMs are the unit-safe spellings; both sides derive dt = 1/tickRate, so
    // one declared number drives the server's physics step AND the client's.
    const tickRate =
      opts?.stepSeconds !== undefined ? 1 / opts.stepSeconds :
      opts?.stepMs !== undefined ? 1000 / opts.stepMs :
      opts?.tickRate;
    if (
      opts?.tickRate !== undefined && opts.stepMs === undefined && opts.stepSeconds === undefined &&
      (!Number.isInteger(opts.tickRate) || opts.tickRate > 240)
    ) {
      console.warn(
        `[defineInput] tickRate is a rate in Hz (got ${opts.tickRate}); a value ` +
        `like 1000/rate is a step interval in ms — pass { stepMs } instead.`,
      );
    }
    this.options = {
      ctor: type,
      // Opt-in: a default would silently drop frames for any app with a numeric `seq` field.
      seqField: opts?.seqField,
      bufferMaxSize: opts?.bufferMaxSize ?? 32,
      idle: opts?.idle,
      // Compiled once (map → dense min/max walk); applied per decoded frame.
      sanitize: opts?.sanitize !== undefined ? compileSanitizer(opts.sanitize) : undefined,
      tickRate,
      subSteps: validateSubSteps(opts?.subSteps, 'defineInput'),
    };
    if (!_inputReflectionCache.has(type)) {
      // SDK-deserializable ctor bytes (Reflection.decode rebuilds the ctor client-side).
      _inputReflectionCache.set(type, Reflection.encode(new Encoder(new type())));
    }
    const api = new InputAPIImpl(this) as InputAPI<InstanceType<C>, IdleDeclared<O, InstanceType<C>>>;
    this.api = api;
    return api;
  }

  // --- per-client lifecycle (called from Room._onJoin/_onLeave/etc.) ---

  /** Allocate the per-client input instance + decoder, the ring buffer (opt-in
   *  via `bufferMaxSize > 0`, for rollback/lockstep), and the accessor. */
  allocate(client: Client & ClientPrivate): void {
    client._input = new this.options.ctor();
    client._inputDecoder = new InputDecoder(client._input);
    client._reckonBaseline = 0; // mirrors the SDK's delta-coded stamp baseline (reset together on (re)connect)
    const maxSize = this.options.bufferMaxSize;
    if (maxSize > 0) {
      // ctor → idle synthesis; client ref → idle ctx; idle policy → total drain()/next().
      client._inputBuffer = new InputBufferImpl(maxSize, this.options.seqField, this.options.ctor, client, this.options.idle);
    }
    client._inputAccessor = new InputAccessorImpl(client);
  }

  /** Register a (re)joined client's accessor. On reconnect this overwrites the
   *  dropped session's stale entry. Called after the client is in `this.clients`
   *  (so a pre-push failure can't leak it) and before onJoin (so `get()` resolves
   *  there). */
  register(sessionId: string, client: ClientPrivate): void {
    this.accessors.set(sessionId, client._inputAccessor!);
  }

  /** Freeze a leaving seat: drop pending inputs so a held (reconnecting) session
   *  idles from the first tick rather than replaying last-known moves. `_input`
   *  (the idle ctx's `latest`) is left intact. */
  freeze(client: ClientPrivate): void {
    client._inputBuffer?.clear();
  }

  /** Drop a fully-gone session's accessor (delete of a missing key is a no-op). */
  release(sessionId: string): void {
    this.accessors.delete(sessionId);
  }

  /** Release every held accessor (room dispose). */
  dispose(): void {
    this.accessors.clear();
  }

  // --- encode / decode (called from Room._onMessage) ---

  /**
   * Sanitize the freshly-decoded `client._input`, then (when buffering is on)
   * push a clone into the per-client buffer. Honors the framework seq
   * (unreliable) / a user `inputOptions.seqField` (reliable) to dedupe the
   * redundancy ring.
   */
  capture(client: ClientPrivate, renderTime: number = 0, reckonTime: number = 0, seq?: number): void {
    // Sanitize before anything reads it (latest, the clone below, the idle ctx).
    this.options.sanitize?.(client._input);
    const buf = client._inputBuffer;
    if (!buf) { return; } // no consumer registered — skip the clone allocation
    const inst = client._input!;
    if (seq !== undefined) {
      // Unreliable: dedup the ring by the framework wire seq (user seqField is for .at() only).
      if (!buf.accept(seq)) { return; }
    } else {
      // Reliable: no framework seq (implicit count). Honor a user `seqField` if set.
      const seqField = this.options.seqField;
      if (seqField !== undefined) {
        const value = (inst as any)[seqField] as number;
        if (typeof value === 'number' && !buf.accept(value)) { return; }
      }
    }
    buf.push(inst.clone() as any, renderTime, reckonTime, seq);
  }

  /** Decode a `ROOM_INPUT_RELIABLE` frame: an optional TIMED stamp prefix (shape
   *  set by this room's derived stamp mode) then the input body. `it` starts at
   *  offset 1, so the body begins at `it.offset`. */
  decodeReliable(client: ClientPrivate, buffer: Buffer, it: Iterator, modifiers: number): void {
    if (!client._inputDecoder) { return; }
    // Optional stamp prefix (TIMED bit), DELTA-CODED, length set by this room's
    // stamp mode (the timeline value is reconstructed against the per-client
    // baseline; the wire carries only the signed change from the previous frame):
    //   both:        [varint Δreckon][uint16 renderDelta] → renderTime = reckon − renderDelta
    //   reckon-only: [varint Δreckon]
    //   render-only: [varint Δrender]
    let renderTime = 0;
    let reckonTime = 0;
    if (modifiers & ProtocolModifier.TIMED) {
      this.#resolveWireModes();
      // Reconstruct the absolute timeline value: baseline += signed delta. Both
      // sides start at 0 (so the first delta is absolute) and re-zero together on
      // (re)connect; reliable+in-order keeps the mirror locked.
      const stamp = client._reckonBaseline! += decode.number(buffer, it);
      if (this.#stampReckon && this.#stampRender) {
        reckonTime = stamp;
        const renderDelta = decode.uint16(buffer, it);
        renderTime = stamp > renderDelta ? stamp - renderDelta : 0;
      } else if (this.#stampReckon) {
        reckonTime = stamp;
      } else {
        renderTime = stamp;
      }
    }
    try {
      client._inputDecoder.decode(buffer.subarray(it.offset, buffer.byteLength));
    } catch (e: any) {
      debugAndPrintError(e);
      return;
    }
    client._lastInputReceivedAt = performance.now();
    // Mirrors the SDK's sent count; echoed back as lastInputSeq for RTT.
    client._receivedInputCount = (client._receivedInputCount ?? 0) + 1;
    this.capture(client, renderTime, reckonTime);
  }

  /** Decode a `ROOM_INPUT_UNRELIABLE` redundancy ring — each slot carries its
   *  framework seq (base seq + position) for ring dedupe, no user seqField. */
  decodeUnreliable(client: ClientPrivate, buffer: Buffer, _modifiers: number): void {
    if (!client._inputDecoder) { return; }
    try {
      client._inputDecoder.decodeAll(buffer.subarray(1), (_inst, seq) => this.capture(client, 0, 0, seq));
    } catch (e: any) {
      debugAndPrintError(e);
      return;
    }
    client._lastInputReceivedAt = performance.now();
  }

  // --- handshake + stamp mode ---

  /** Resolve the wire stamp mode from the rewind timeline (once, then frozen). */
  #resolveWireModes(): void {
    if (this.#stampResolved) return;
    this.#stampResolved = true;
    const tl = this.room._timelineMode();
    this.#stampRender = tl?.snapshot ?? false;
    this.#stampReckon = tl?.reckon ?? false;
  }

  /**
   * The join-handshake input sections: INPUT_REFLECTION (the SDK-deserializable
   * input ctor bytes) and, when any runtime config differs from defaults,
   * INPUT_OPTIONS (`[flags uint8][tickRate varint?][patchRate varint?][subSteps
   * varint?]`). The client mirrors RENDER_TIME/RECKON_TIME (auto-stamp timeline),
   * tickRate (predict at dt=1/tickRate), patchRate (reconcile cadence), and
   * subSteps (physics sub-steps per input, omitted when 1). Returns `undefined`
   * when there's nothing to add.
   */
  handshakeSections(): Array<{ tag: number; bytes: Uint8Array }> | undefined {
    let sections: Array<{ tag: number; bytes: Uint8Array }> | undefined;
    const inputBytes = _inputReflectionCache.get(this.options.ctor);
    if (inputBytes !== undefined) {
      sections = [{ tag: HandshakeSection.INPUT_REFLECTION, bytes: inputBytes }];
    }
    this.#resolveWireModes();
    const stampRender = this.#stampRender;
    const stampReckon = this.#stampReckon;
    const tickRate = this.options.tickRate;
    const patchRate = (typeof this.room.patchRate === "number" && this.room.patchRate > 0)
      ? Math.round(this.room.patchRate) : undefined;
    const subSteps = (this.options.subSteps !== undefined && this.options.subSteps > 1)
      ? this.options.subSteps : undefined;
    if (stampRender || stampReckon || tickRate || patchRate || subSteps) {
      let flags = 0;
      if (stampRender) { flags |= InputFlags.RENDER_TIME; }
      if (stampReckon) { flags |= InputFlags.RECKON_TIME; }
      if (tickRate) { flags |= InputFlags.FIXED_TIMESTEP; }
      if (patchRate) { flags |= InputFlags.PATCH_RATE; }
      if (subSteps) { flags |= InputFlags.SUB_STEPS; }
      // 24B: worst case = flags + float64 tickRate (9) + uint32 patchRate (5) + subSteps (2).
      const buf = new Uint8Array(24);
      const sit = { offset: 0 };
      buf[sit.offset++] = flags;
      if (tickRate) { encode.number(buf, tickRate, sit); }
      if (patchRate) { encode.number(buf, patchRate, sit); }
      if (subSteps) { encode.number(buf, subSteps, sit); }
      (sections ??= []).push({
        tag: HandshakeSection.INPUT_OPTIONS,
        bytes: buf.subarray(0, sit.offset),
      });
    }
    return sections;
  }
}
