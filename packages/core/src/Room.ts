import { unpack } from 'msgpackr';
import { decode, encode, Encoder, Reflection, type Iterator, $changes } from '@colyseus/schema';
import { InputDecoder } from '@colyseus/schema/input';
import { type InputAccessor, type InputAPI, type InputOptions, type NumericFieldsOf, InputAccessorImpl, InputBufferImpl, NO_OP_INPUT_ACCESSOR } from './input/InputBuffer.ts';
import { Rewind, type RewindOptions } from './Rewind.ts';
export { type InputAccessor, type InputAPI, type InputOptions, type NumericFieldsOf } from './input/InputBuffer.ts';

/**
 * Module-level cache of `Reflection.encode` output keyed by input
 * constructor — pays the encoding cost once per Room class regardless of
 * room instance count. WeakMap so unused classes can be GC'd.
 */
const _inputReflectionCache = new WeakMap<Function, Uint8Array>();
import { ClockTimer as Clock } from '@colyseus/timer';

import { EventEmitter } from 'events';
import { logger } from './Logger.ts';

import type { Presence } from './presence/Presence.ts';
import type { Serializer } from './serializer/Serializer.ts';
import type { IRoomCache } from './matchmaker/driver.ts';

import { NoneSerializer } from './serializer/NoneSerializer.ts';
import { SchemaSerializer } from './serializer/SchemaSerializer.ts';

import { getMessageBytes } from './Protocol.ts';
import { type Type, Deferred, generateId, wrapTryCatch } from './utils/Utils.ts';
import { createNanoEvents } from './utils/nanoevents.ts';
import { isDevMode } from './utils/DevMode.ts';

import { debugAndPrintError, debugMatchMaking, debugMessage } from './Debug.ts';
import { ServerError } from './errors/ServerError.ts';
import { ClientState, type AuthContext, type Client, type ClientPrivate, ClientArray, type ISendOptions, type MessageArgs } from './Transport.ts';
import { type RoomMethodName, OnAuthException, OnCreateException, OnDisposeException, OnDropException, OnJoinException, OnLeaveException, OnMessageException, OnReconnectException, type RoomException, SimulationIntervalException, TimedEventException } from './errors/RoomExceptions.ts';

import { standardValidate, type StandardSchemaV1 } from './utils/StandardSchema.ts';
import * as matchMaker from './MatchMaker.ts';

import {
  CloseCode,
  ErrorCode,
  HandshakeSection,
  InputFlags,
  Protocol,
  PROTOCOL_CODE_MASK,
  PROTOCOL_MODIFIER_MASK,
  ResponseStatus,
  type MessageHandlerWithFormat as SharedMessageHandlerWithFormat,
  type MessageHandler as SharedMessageHandler,
  type Messages as SharedMessages,
} from '@colyseus/shared-types';

import {
  RoomPlugin,
  setupRoomPlugins,
  type PluginLayout,
} from './RoomPlugin.ts';
export {
  RoomPlugin,
  definePlugins,
  attachToTestRoom,
  type RoomPluginOrder,
} from './RoomPlugin.ts';

const DEFAULT_PATCH_RATE = 1000 / 20; // 20fps (50ms)
const DEFAULT_SIMULATION_INTERVAL = 1000 / 60; // 60fps (16.66ms)
const noneSerializer = new NoneSerializer();

// Shape an Error (or thrown value) into a plain, msgpack-friendly object for a
// ROOM_RESPONSE error payload. Only `name`/`message`/`code` cross the wire —
// stacks stay on the server.
function toResponseError(e: any): { name: string; message: string; code?: any } {
  if (e instanceof Error) {
    const code = (e as any).code;
    return (code !== undefined)
      ? { name: e.name, message: e.message, code }
      : { name: e.name, message: e.message };
  }
  return { name: "Error", message: String(e) };
}

export const DEFAULT_SEAT_RESERVATION_TIME = Number(process.env.COLYSEUS_SEAT_RESERVATION_TIME || 15);

export type SimulationCallback = (deltaTime: number) => void;

/**
 * Per-step context passed to a {@link Room.setFixedTimestep} callback. Carries
 * ONLY the fixed simulation step — never wall-clock/measured time — so feeding a
 * jittery delta into deterministic sim math is unrepresentable. The same fixed
 * `dt` is advertised to clients so prediction integrates identically. (The
 * client's step context additionally carries an `isReplay` flag for rollback
 * re-simulation; the server is authoritative and never replays, so it has none.)
 */
export interface StepContext {
  /** Fixed step in SECONDS (`1/tickRate`) — the dt to integrate one step with. */
  readonly dt: number;
  /** Fixed step in MILLISECONDS (`1000/tickRate`). */
  readonly dtMs: number;
  /** Monotonic index of the fixed step being simulated. */
  readonly tick: number;
}

/** Fixed-timestep simulation callback. @see Room.setFixedTimestep */
export type FixedTimestepCallback = (ctx: StepContext) => void;

export interface RoomOptions {
  state?: object;
  metadata?: any;
  client?: Client;
  /**
   * Schema class for client→server input packets. When set, the Room
   * allocates one instance per joining client and binds an InputDecoder.
   * Must be a flat Schema (primitive fields only — see InputEncoder docs).
   *
   * Typed loosely (no `Schema` constraint) to avoid type-identity clashes
   * when the user's app loads a different copy of `@colyseus/schema` than
   * `@colyseus/core` does. Runtime validation happens via the encoder.
   */
  input?: any;
}

// Helper types to extract individual properties from RoomOptions
export type ExtractRoomState<T> = T extends { state?: infer S extends object } ? S : any;
export type ExtractRoomMetadata<T> = T extends { metadata?: infer M } ? M : any;
export type ExtractRoomClient<T> = T extends { client?: infer C extends Client } ? C : Client;
export type ExtractRoomInput<T> = T extends { input?: infer I } ? I : never;

export interface IBroadcastOptions extends ISendOptions {
  except?: Client | Client[];
}

/**
 * Message handler with automatic type inference from format schema.
 * When a format is provided, the message type is automatically inferred from the schema.
 */
export type MessageHandlerWithFormat<T extends StandardSchemaV1 = any, This = any> =
  SharedMessageHandlerWithFormat<T, Client, This>;

export type MessageHandler<This = any> = SharedMessageHandler<Client, This>;

/**
 * A map of message types to message handlers.
 */
export type Messages<This extends Room> = SharedMessages<This, Client>;

/**
 * Helper function to create a validated message handler with automatic type inference.
 *
 * @example
 * ```typescript
 * messages = {
 *   move: validate(z.object({ x: z.number(), y: z.number() }), (client, message) => {
 *     // message.x and message.y are automatically typed as numbers
 *     console.log(message.x, message.y);
 *   })
 * }
 * ```
 */
export function validate<T extends StandardSchemaV1, This = any>(
  format: T,
  handler: (this: This, client: Client, message: StandardSchemaV1.InferOutput<T>) => void
): MessageHandlerWithFormat<T, This> {
  return { format, handler };
}

export const RoomInternalState = {
  CREATING: 0,
  CREATED: 1,
  DISPOSING: 2,
} as const;
export type RoomInternalState = (typeof RoomInternalState)[keyof typeof RoomInternalState];

export type OnCreateOptions<T extends Type<Room>> = Parameters<NonNullable<InstanceType<T>['onCreate']>>[0];

/**
 * A Room class is meant to implement a game session, and/or serve as the communication channel
 * between a group of clients.
 *
 * - Rooms are created on demand during matchmaking by default
 * - Room classes must be exposed using `.define()`
 *
 * @example
 * ```typescript
 * class MyRoom extends Room<{
 *   state: MyState,
 *   metadata: { difficulty: string },
 *   client: MyClient
 * }> {
 *   // ...
 * }
 * ```
 */
export class Room<T extends RoomOptions = RoomOptions> {
  '~client': ExtractRoomClient<T>;
  '~state': ExtractRoomState<T>;
  '~metadata': ExtractRoomMetadata<T>;

  /**
   * This property will change on these situations:
   * - The maximum number of allowed clients has been reached (`maxClients`)
   * - You manually locked, or unlocked the room using lock() or `unlock()`.
   *
   * @readonly
   */
  public get locked() {
    return this.#_locked;
  }

  /**
   * Get the room's matchmaking metadata.
   */
  public get metadata(): ExtractRoomMetadata<T> {
    return this._listing.metadata;
  }

  /**
   * Set the room's matchmaking metadata.
   *
   * **Note**: This setter does NOT automatically persist. Use `setMatchmaking()` for automatic persistence.
   *
   * @example
   * ```typescript
   * class MyRoom extends Room<{ metadata: { difficulty: string; rating: number } }> {
   *   async onCreate() {
   *     this.metadata = { difficulty: "hard", rating: 1500 };
   *   }
   * }
   * ```
   */
  public set metadata(meta: ExtractRoomMetadata<T>) {
    if (this._internalState !== RoomInternalState.CREATING) {
      // prevent user from setting metadata after room has been created.
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "'metadata' can only be manually set during onCreate(). Use setMatchmaking() instead.");
    }

    this._listing.metadata = meta;
  }

  /**
   * The room listing cache for matchmaking.
   * @internal
   */
  private _listing: IRoomCache<ExtractRoomMetadata<T>>;

  /**
   * Timing events tied to the room instance.
   * Intervals and timeouts are cleared when the room is disposed.
   */
  public clock: Clock = new Clock();

  #_roomId: string;
  #_roomName: string;
  #_onLeaveConcurrent: number = 0; // number of onLeave calls in progress

  /**
   * Maximum number of clients allowed to connect into the room. When room reaches this limit,
   * it is locked automatically. Unless the room was explicitly locked by you via `lock()` method,
   * the room will be unlocked as soon as a client disconnects from it.
   */
  public maxClients: number = Infinity;
  #_maxClientsReached: boolean = false;
  #_maxClients: number;

  /**
   * Automatically dispose the room when last client disconnects.
   *
   * @default true
   */
  public autoDispose: boolean = true;
  #_autoDispose: boolean;

  /**
   * Frequency to send the room state to connected clients, in milliseconds.
   *
   * @default 50ms (20fps)
   */
  public patchRate: number | null = DEFAULT_PATCH_RATE;
  #_patchRate: number;
  #_patchInterval: NodeJS.Timeout;

  /**
   * Maximum number of messages a client can send to the server per second.
   * If a client sends more messages than this, it will be disconnected.
   *
   * @default Infinity
   */
  public maxMessagesPerSecond: number = Infinity;

  /**
   * The state instance you provided to `setState()`.
   */
  public state: ExtractRoomState<T>;
  #_state: ExtractRoomState<T>;

  /**
   * The presence instance. Check Presence API for more details.
   *
   * @see [Presence API](https://docs.colyseus.io/server/presence)
   */
  public presence: Presence;

  /**
   * The array of connected clients.
   *
   * @see [Client instance](https://docs.colyseus.io/room#client)
   */
  public clients: ClientArray<ExtractRoomClient<T>> = new ClientArray();

  /**
   * Set the number of seconds a room can wait for a client to effectively join the room.
   * You should consider how long your `onAuth()` will have to wait for setting a different seat reservation time.
   * The default value is 15 seconds. You may set the `COLYSEUS_SEAT_RESERVATION_TIME`
   * environment variable if you'd like to change the seat reservation time globally.
   *
   * @default 15 seconds
   */
  public seatReservationTimeout: number = DEFAULT_SEAT_RESERVATION_TIME;

  private _events = new EventEmitter();

  private _reservedSeats: { [sessionId: string]: [any, any, boolean?, boolean?] } = {};
  private _reservedSeatTimeouts: { [sessionId: string]: NodeJS.Timeout } = {};

  private _reconnections: { [reconnectionToken: string]: [string, Deferred] } = {};
  private _reconnectionAttempts: { [reconnectionToken: string]: Deferred } = {};

  public messages?: Messages<any>;

  /**
   * Room plugins, keyed by an operator-chosen handle. Each plugin
   * contributes any subset of: declarative message handlers (merged
   * into `this.messages`), lifecycle hooks (composed with the room's
   * own), and public methods callable via `this.plugins.<key>.X()`.
   *
   * The framework walks this record once per Room subclass to compute
   * the lifecycle/message layout and install hook wrappers on the
   * class prototype; subsequent constructs reuse the cached layout
   * and just inject `.room` + merge messages.
   *
   * Use `definePlugins({...})` so TypeScript preserves each plugin's
   * literal instance type. Frozen after `__init`.
   */
  public plugins?: any;

  /**
   * Auto-included plugin instances pulled in via `static
   * dependencies` declarations on user-registered plugins. Kept
   * separate from `this.plugins` so the user's typed view doesn't
   * gain framework-managed keys. Sentinel-keyed (`__dep:<ClassName>`)
   * so the hook wrappers can route lookups to the right map.
   *
   * @internal
   */
  public _autoPlugins?: Record<string, RoomPlugin<any>>;

  /**
   * Layout cache populated on the FIRST construction of each Room
   * subclass. Holds the precomputed hook participation order + message
   * key → plugin key mapping. Stored on the constructor (a static field)
   * so all instances of the same class share it.
   *
   * `null` is a sentinel meaning "no plugins on this class" — distinct
   * from `undefined` ("not yet computed") so we don't re-walk an empty
   * plugin record on every construct.
   *
   * @internal
   */
  static __pluginLayout?: PluginLayout | null;

  private onMessageEvents = createNanoEvents();
  private onMessageValidators: {[message: string]: StandardSchemaV1} = {};

  private onMessageFallbacks = {
    '__no_message_handler': (client: ExtractRoomClient<T>, messageType: string | number, _: unknown) => {
      const errorMessage = `room onMessage for "${messageType}" not registered.`;
      debugMessage(`${errorMessage} (roomId: ${this.roomId})`);

      if (isDevMode) {
        // send error code to client in development mode
        client.error(ErrorCode.INVALID_PAYLOAD, errorMessage);

      } else {
        // immediately close the connection in production
        client.leave(CloseCode.WITH_ERROR, errorMessage);
      }
    }
  };

  private _serializer: Serializer<ExtractRoomState<T>> = noneSerializer;
  private _afterNextPatchQueue: Array<[string | number | ExtractRoomClient<T>, ArrayLike<any>]> = [];

  private _simulationInterval: NodeJS.Timeout;

  private _internalState: RoomInternalState = RoomInternalState.CREATING;

  private _lockedExplicitly: boolean = false;
  #_locked: boolean = false;

  // this timeout prevents rooms that are created by one process, but no client
  // ever had success joining into it on the specified interval.
  private _autoDisposeTimeout: NodeJS.Timeout;

  constructor() {
    this._events.once('dispose', () => {
      this.#_dispose()
        .catch((e) => debugAndPrintError(`onDispose error: ${(e && e.stack || e.message || e || 'promise rejected')} (roomId: ${this.roomId})`))
        .finally(() => this._events.emit('disconnect'));
    });

    /**
     * If `onUncaughtException` is defined, it will automatically catch exceptions
     */
    if (this.onUncaughtException !== undefined) {
      this.#registerUncaughtExceptionHandlers();
    }
  }

  /**
   * This method is called by the MatchMaker before onCreate()
   * @internal
   */
  private __init() {
    this.#_state = this.state;
    this.#_autoDispose = this.autoDispose;
    this.#_patchRate = this.patchRate;
    this.#_maxClients = this.maxClients;

    Object.defineProperties(this, {
      state: {
        enumerable: true,
        get: () => this.#_state,
        set: (newState: ExtractRoomState<T>) => {
          if (newState?.constructor[Symbol.metadata] !== undefined || newState[$changes] !== undefined) {
            this.setSerializer(new SchemaSerializer());
          } else if ('_definition' in newState) {
            throw new Error("@colyseus/schema v2 compatibility currently missing (reach out if you need it)");
          } else if ($changes === undefined) {
            throw new Error("Multiple @colyseus/schema versions detected. Please make sure you don't have multiple versions of @colyseus/schema installed.");
          }
          this._serializer.reset(newState);
          this.#_state = newState;
        },
      },

      maxClients: {
        enumerable: true,
        get: () => this.#_maxClients,
        set: (value: number) => {
          this.setMatchmaking({ maxClients: value });
        },
      },

      autoDispose: {
        enumerable: true,
        get: () => this.#_autoDispose,
        set: (value: boolean) => {
          if (
            value !== this.#_autoDispose &&
            this._internalState !== RoomInternalState.DISPOSING
          ) {
            this.#_autoDispose = value;
            this.resetAutoDisposeTimeout();
          }
        },
      },

      patchRate: {
        enumerable: true,
        get: () => this.#_patchRate,
        set: (milliseconds: number) => {
          this.#_patchRate = milliseconds;
          // clear previous interval in case called setPatchRate more than once
          if (this.#_patchInterval) {
            clearInterval(this.#_patchInterval);
            this.#_patchInterval = undefined;
          }
          if (milliseconds !== null && milliseconds !== 0) {
            this.#_patchInterval = setInterval(() => this.broadcastPatch(), milliseconds);
          } else if (!this._simulationInterval) {
            // When patchRate and no simulation interval are both set to 0, tick the clock to keep timers working
            this.#_patchInterval = setInterval(() => this.clock.tick(), DEFAULT_SIMULATION_INTERVAL);
          }
        },
      },
    });

    // set patch interval, now with the setter
    this.patchRate = this.#_patchRate;

    // set state, now with the setter
    if (this.#_state) {
      this.state = this.#_state;
    }

    // Wire room plugins from the instance-level `this.plugins` record.
    // The heavy lifting (conflict detection, hook participation, hook
    // wrapping on the prototype) runs once per class — see
    // `setupRoomPlugins` in `./RoomPlugin.ts`. Per-instance: set
    // `plugin.room = this`, instantiate auto-deps, merge messages.
    if (this.plugins !== undefined) {
      setupRoomPlugins(this);
    }

    // Bind messages to the room
    if (this.messages !== undefined) {

      // Handle "_" as a fallback handler
      if (this.messages['_']) {
        this.onMessage('*', (this.messages['_'] as Function).bind(this));
        delete this.messages['_'];
      }

      Object.entries(this.messages).forEach(([messageType, callback]) => {
        if (typeof callback === 'function') {
          // Direct handler function - bind to room instance
          this.onMessage(messageType, callback.bind(this) as any);
        } else {
          // Object with format and handler - bind handler to room instance
          this.onMessage(messageType, callback.format, callback.handler.bind(this));
        }
      });
    }

    // set default _autoDisposeTimeout
    this.resetAutoDisposeTimeout(this.seatReservationTimeout);

    this.clock.start();
  }


  /**
   * The name of the room you provided as first argument for `gameServer.define()`.
   *
   * @returns roomName string
   */
  public get roomName() { return this.#_roomName; }
  /**
   * Setting the name of the room. Overwriting this property is restricted.
   *
   * @param roomName
   */
  public set roomName(roomName: string) {
    if (this.#_roomName) {
      // prevent user from setting roomName after it has been defined.
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "'roomName' cannot be overwritten.");
    }
    this.#_roomName = roomName;
  }

  /**
   * A unique, auto-generated, 9-character-long id of the room.
   * You may replace `this.roomId` during `onCreate()`.
   *
   * @returns roomId string
   */
  public get roomId() { return this.#_roomId; }

  /**
   * Setting the roomId, is restricted in room lifetime except upon room creation.
   *
   * @param roomId
   * @returns roomId string
   */
  public set roomId(roomId: string) {
    if (this._internalState !== RoomInternalState.CREATING && !isDevMode) {
      // prevent user from setting roomId after room has been created.
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "'roomId' can only be overridden upon room creation.");
    }
    this.#_roomId = roomId;
  }

  // Optional abstract methods

  /**
   * This method is called before the latest version of the room's state is broadcasted to all clients.
   */
  public onBeforePatch?(state: ExtractRoomState<T>): void | Promise<any>;

  /**
   * This method is called when the room is created.
   * @param options - The options passed to the room when it is created.
   */
  public onCreate?(options: any): void | Promise<any>;

  /**
   * This method is called when a client joins the room.
   * @param client - The client that joined the room.
   * @param options - The options passed to the client when it joined the room.
   * @param auth - The data returned by the `onAuth` method - (Deprecated: use `client.auth` instead)
   */
  public onJoin?(client: ExtractRoomClient<T>, options?: any, auth?: any): void | Promise<any>;

  /**
   * This method is called when a client leaves the room without consent.
   * You may allow the client to reconnect by calling `allowReconnection` within this method.
   *
   * @param client - The client that was dropped from the room.
   * @param code - The close code of the leave event.
   */
  public onDrop?(client: ExtractRoomClient<T>, code?: number): void | Promise<any>;

  /**
   * This method is called when a client reconnects to the room.
   * @param client - The client that reconnected to the room.
   */
  public onReconnect?(client: ExtractRoomClient<T>): void | Promise<any>;

  /**
   * This method is called when a client effectively leaves the room.
   * @param client - The client that left the room.
   * @param code - The close code of the leave event.
   */
  public onLeave?(client: ExtractRoomClient<T>, code?: number): void | Promise<any>;

  /**
   * Per-client input accessor. Set by `defineInput()`. Call `room.input(sessionId)`
   * each tick to read the latest decoded input and/or the buffered snapshot ring
   * for that client.
   *
   * @example
   * ```typescript
   * class FpsRoom extends Room<{ input: MoveInput }> {
   *   input = this.defineInput(MoveInput);
   *
   *   onCreate() {
   *     this.setTimestep(() => {
   *       for (const c of this.clients) {
   *         const input = this.input(c.sessionId);
   *         if (input.latest) this.apply(c, input.latest);
   *         // for rollback / lockstep:
   *         //   const snapshot = input.at(this.clock.ticks);
   *         //   for (const snapshot of input.drain()) ...
   *       }
   *     }, 1000 / 30);
   *   }
   * }
   * ```
   */
  public input?: InputAPI<ExtractRoomInput<T>>;

  /**
   * Input configuration. Set via {@link defineInput} only.
   * @internal
   */
  private _inputOptions?: InputOptions;

  /**
   * `true` when the Room called {@link defineInput}. When set, each state
   * message gets a {@link ProtocolModifier.TIMED} prefix carrying server
   * time and the per-recipient last-input ack — feeds the SDK's `room.clock`.
   */
  private _clientTimingEnabled: boolean = false;

  /**
   * Declare the input schema and configuration in a single line. Returns the
   * callable accessor that gets assigned to `this.input` — call
   * `this.input(sessionId)` per tick to consume.
   *
   * ```typescript
   * class FpsRoom extends Room<{ input: MoveInput }> {
   *   input = this.defineInput(MoveInput, {
   *     seqField: "tick",       // typed: only numeric fields of MoveInput
   *     bufferMaxSize: 64,
   *   });
   *
   *   // …or without options — no seq dedupe, bufferMaxSize: 32:
   *   // input = this.defineInput(MoveInput);
   * }
   * ```
   *
   * **Defaults** when `opts` (or individual fields) are omitted:
   * - `seqField`: unset — dedupe and `room.input(sessionId).at(value)` lookup are
   *   OPT-IN (lockstep / rollback). Name a monotonic numeric field here to enable
   *   them; redundant frames (`input[seqField]` ≤ the last seen) are then dropped.
   *   Leave unset for reliable, in-order channels where every frame is unique.
   * - `bufferMaxSize`: `32` — enables per-client snapshot buffering for
   *   `room.input(sessionId).drain() / .peek() / .at()`. Set to `0` to disable
   *   buffering (the `.latest` read still works).
   */
  protected defineInput<C extends new () => any>(
    type: C,
    opts?: {
      seqField?: NumericFieldsOf<InstanceType<C>>;
      bufferMaxSize?: number;
      /**
       * Enable render-time lag compensation: the client auto-stamps each
       * reliable input with the server-clock time (ms since room start) it was
       * rendering the world at, surfaced server-side as
       * `room.input(sessionId).renderTime`. Rewind other entities to that time
       * for "what you see is what you hit". Default `false` (+4 bytes/input
       * when on).
       */
      renderTime?: boolean;
      /**
       * Fixed step rate in **Hz** cascaded to the client via the join handshake;
       * it predicts at dt = 1/tickRate for deterministic rollback. Defaults to
       * the `setTimestep` rate — pass this only when the prediction
       * step differs from it. NOTE: a *rate*, not an interval — `1000/30` is the
       * step in ms, a classic mistake; use {@link stepMs} for that. Superseded by
       * {@link stepMs} / {@link stepSeconds} when those are given.
       */
      tickRate?: number;
      /**
       * Fixed step as a duration in **milliseconds** — the unit-safe alternative
       * to {@link tickRate} (`stepMs: 1000/30` is unambiguous where
       * `tickRate: 1000/30` is a bug). Normalized to the canonical Hz value
       * (`1000/stepMs`). Takes precedence over `tickRate`.
       */
      stepMs?: number;
      /**
       * Fixed step as a duration in **seconds** (e.g. `1/30`). Normalized to the
       * canonical Hz value (`1/stepSeconds`). Highest precedence.
       */
      stepSeconds?: number;
    },
  ): InputAPI<InstanceType<C>> {
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
    this._inputOptions = {
      ctor: type,
      // No default: dedupe + `.at()` lookup are OPT-IN. A default of "seq"
      // would silently drop frames for any app that happened to name a numeric
      // field `seq` — behavior-by-coincidental-naming. Pass `seqField`
      // explicitly to enable lockstep/rollback ordering.
      seqField: opts?.seqField,
      bufferMaxSize: opts?.bufferMaxSize ?? 32,
      renderTime: opts?.renderTime ?? false,
      tickRate,
    };
    // Enable wire-level timing for clients that advertise CLIENT_TIMING.
    // Defining inputs is the natural "real-time room" gate — chat / lobby /
    // turn-based rooms that don't call defineInput continue to send untimed
    // state and pay zero overhead.
    this._clientTimingEnabled = true;
    if (!_inputReflectionCache.has(type)) {
      // Reflection.encode walks the schema's TypeContext via a one-shot
      // Encoder around a throwaway instance; the bytes are SDK-deserializable
      // back into a constructor through Reflection.decode.
      _inputReflectionCache.set(type, Reflection.encode(new Encoder(new type())));
    }
    const api = ((sessionId: string): InputAccessor<InstanceType<C>> => {
      const c = this.clients.getById(sessionId) as unknown as ClientPrivate | undefined;
      return (c?._inputAccessor as InputAccessor<InstanceType<C>>) ?? NO_OP_INPUT_ACCESSOR;
    }) as InputAPI<InstanceType<C>>;
    // Room-level fixed step (one source, not per-client). Live getters off
    // _inputOptions so an auto-derived tickRate — set later by
    // setTimestep — is reflected. dt = 1/tickRate; `1/hz` is
    // correctly-rounded IEEE-754, so it matches the client's stepSeconds bit-for-bit.
    Object.defineProperty(api, "tickRate", {
      enumerable: true,
      get: () => this._inputOptions?.tickRate,
    });
    Object.defineProperty(api, "stepSeconds", {
      enumerable: true,
      get: () => { const hz = this._inputOptions?.tickRate; return hz ? 1 / hz : undefined; },
    });
    Object.defineProperty(api, "stepMs", {
      enumerable: true,
      get: () => { const hz = this._inputOptions?.tickRate; return hz ? 1000 / hz : undefined; },
    });
    return api;
  }

  /**
   * This method is called when the room is disposed.
   */
  public onDispose?(): void | Promise<any>;

  /**
   * Define a custom exception handler.
   * If defined, all lifecycle hooks will be wrapped by try/catch, and the exception will be forwarded to this method.
   *
   * These methods will be wrapped by try/catch:
   * - `onMessage`
   * - `onAuth` / `onJoin` / `onLeave` / `onCreate` / `onDispose`
   * - `clock.setTimeout` / `clock.setInterval`
   * - `setTimestep` / `setFixedTimestep`
   *
   * (Experimental: this feature is subject to change in the future - we're currently getting feedback to improve it)
   */
  public onUncaughtException?(error: RoomException, methodName: RoomMethodName): void;

  /**
   * This method is called before onJoin() - this is where you should authenticate the client
   * @param client - The client that is authenticating.
   * @param options - The options passed to the client when it is authenticating.
   * @param context - The authentication context, including the token and the client's IP address.
   * @returns The authentication result.
   *
   * @example
   * ```typescript
   * return {
   *   userId: 123,
   *   username: "John Doe",
   *   email: "john.doe@example.com",
   * };
   * ```
   */
  public onAuth(
    client: Client,
    options: any,
    context: AuthContext
  ): any | Promise<any> {
    return true;
  }

  static async onAuth(
    token: string,
    options: any,
    context: AuthContext
  ): Promise<unknown> {
    return true;
  }

  /**
   * This method is called during graceful shutdown of the server process
   * You may override this method to dispose the room in your own way.
   *
   * Once process reaches room count of 0, the room process will be terminated.
   */
  public onBeforeShutdown() {
    this.disconnect(
      (isDevMode)
        ? CloseCode.MAY_TRY_RECONNECT
        : CloseCode.SERVER_SHUTDOWN
    ).catch(() => {});
  }

  /**
   * devMode: When `devMode` is enabled, `onCacheRoom` method is called during
   * graceful shutdown.
   *
   * Implement this method to return custom data to be cached. `onRestoreRoom`
   * will be called with the data returned by `onCacheRoom`
   */
  public onCacheRoom?(): any;

  /**
   * devMode: When `devMode` is enabled, `onRestoreRoom` method is called during
   * process startup, with the data returned by the `onCacheRoom` method.
   */
  public onRestoreRoom?(cached?: any): void;

  /**
   * Returns whether the sum of connected clients and reserved seats exceeds maximum number of clients.
   *
   * @returns boolean
   */
  public hasReachedMaxClients(): boolean {
    return (
      (this.clients.length + Object.keys(this._reservedSeats).length) >= this.#_maxClients ||
      this._internalState === RoomInternalState.DISPOSING
    );
  }

  /**
   * @deprecated Use `seatReservationTimeout=` instead.
   */
  public setSeatReservationTime(seconds: number) {
    console.warn(`DEPRECATED: .setSeatReservationTime(${seconds}) is deprecated. Assign a .seatReservationTimeout property value instead.`);
    this.seatReservationTimeout = seconds;
    return this;
  }

  public hasReservedSeat(sessionId: string, reconnectionToken?: string): boolean {
    const reservedSeat = this._reservedSeats[sessionId];

    if (reservedSeat) {
      // seat reservation is present
      return (
        // not consumed
        (reservedSeat[2] === false) ||
        // reconnection is allowed and the reconnection token is valid.
        (reservedSeat[3] && this._reconnections[reconnectionToken]?.[0] === sessionId)
      )

    } else if (typeof(reconnectionToken) === "string") {
        // potentially a stale client reference, so a reconnection attempt is possible.
        return this.clients.getById(sessionId)?.reconnectionToken === reconnectionToken;
    }

    return false;
  }

  public checkReconnectionToken(reconnectionToken: string) {
    const sessionId = this._reconnections[reconnectionToken]?.[0];
    const reservedSeat = this._reservedSeats[sessionId];

    if (reservedSeat && reservedSeat[3]) {
      return sessionId;
    }

    const client = this.clients.find((client) => client.reconnectionToken === reconnectionToken);
    if (client) {
      this.#_forciblyCloseClient(client as ExtractRoomClient<T> & ClientPrivate, CloseCode.WITH_ERROR);
      return client.sessionId;
    }

    return undefined;
  }

  /**
   * Set the room's game loop. `onTickCallback` runs every `delay` ms and receives
   * the MEASURED wall-clock delta since the previous tick (a VARIABLE timestep).
   * For deterministic, prediction-friendly simulation prefer
   * {@link Room.setFixedTimestep}, which advances a fixed step via an accumulator.
   *
   * @default 16.6ms (60fps)
   *
   * @param onTickCallback - Your physics / world update — a good place to mutate
   *  room state. Receives the measured delta (`this.clock.deltaTime`).
   * @param delay - Interval between ticks in milliseconds.
   */
  public setTimestep(onTickCallback?: SimulationCallback, delay: number = DEFAULT_SIMULATION_INTERVAL): void {
    // clear previous loop in case it was set more than once
    if (this._simulationInterval) { clearInterval(this._simulationInterval); }

    // Advertise this loop's rate to predicting clients unless set explicitly.
    if (onTickCallback && this._inputOptions && this._inputOptions.tickRate === undefined) {
      this._inputOptions.tickRate = Math.round(1000 / delay);
    }

    if (onTickCallback) {
      if (this.onUncaughtException !== undefined) {
        onTickCallback = wrapTryCatch(onTickCallback, this.onUncaughtException.bind(this), SimulationIntervalException, 'setTimestep');
      }

      this._simulationInterval = setInterval(() => {
        this.clock.tick();
        onTickCallback(this.clock.deltaTime);
        // Lag-comp: snapshot tracked entities AFTER the tick. Skipped if the room
        // recorded this tick manually (its `record()` wins). `delay` sizes the rings.
        const rw = this.#rewind;
        if (rw !== undefined && rw.lastRecordedAt !== this.clock.elapsedTime) {
          rw.record(this.clock.elapsedTime, delay);
        }
      }, delay);
    }
  }

  /**
   * @deprecated Renamed to {@link Room.setTimestep} (which pairs with
   * {@link Room.setFixedTimestep}). Kept for backwards compatibility — forwards
   * to `setTimestep` unchanged.
   */
  public setSimulationInterval(onTickCallback?: SimulationCallback, delay: number = DEFAULT_SIMULATION_INTERVAL): void {
    this.setTimestep(onTickCallback, delay);
  }

  /**
   * Fixed-timestep game loop with a framework-owned accumulator — the right
   * default for prediction/rollback. Unlike {@link setTimestep} (which
   * hands you the *measured* wall-clock delta), this runs `step` a whole number
   * of times per real frame so each step advances by the SAME fixed
   * `dt = 1/tickRate`; the measured delta only decides HOW MANY steps run. The
   * fixed dt is delivered via {@link StepContext}, so the jittery wall-clock
   * delta can't leak into deterministic simulation.
   *
   * `tickRate` is also the SINGLE SOURCE of the simulation rate: it's advertised
   * to predicting clients via the join handshake (they predict at the matching
   * `dt`), so don't also pass `tickRate` to {@link defineInput}.
   *
   * On a hitch the accumulator runs at most a few catch-up steps then drops the
   * backlog (no spiral of death). Lag-comp is recorded once per real frame.
   *
   * @param step - Called once per fixed step with a {@link StepContext}.
   * @param tickRate - Simulation rate in **Hz**. Defaults to 60.
   *
   * @example
   * ```ts
   * onCreate() {
   *   this.setFixedTimestep((ctx) => {
   *     this.stepPlayers(ctx.dt);   // applyInput(p, cmd, level, ctx.dt)
   *     this.stepWorld(ctx.dt);
   *   }, 30);
   * }
   * ```
   */
  public setFixedTimestep(step: FixedTimestepCallback, tickRate: number = Math.round(1000 / DEFAULT_SIMULATION_INTERVAL)): void {
    if (this._simulationInterval) { clearInterval(this._simulationInterval); }

    const stepMs = 1000 / tickRate;
    const stepSeconds = 1 / tickRate;

    // Single source of the fixed rate: advertise it to predicting clients.
    if (this._inputOptions) { this._inputOptions.tickRate = tickRate; }

    let cb = step;
    if (this.onUncaughtException !== undefined) {
      cb = wrapTryCatch(step, this.onUncaughtException.bind(this), SimulationIntervalException, 'setFixedTimestep');
    }

    let acc = 0;
    let tick = 0;
    // Reused per-step context — no per-step allocation in the hot loop.
    const ctx = { dt: stepSeconds, dtMs: stepMs, tick: 0 };
    const MAX_CATCHUP_STEPS = 5;

    this._simulationInterval = setInterval(() => {
      this.clock.tick();
      acc += this.clock.deltaTime;

      // Run a whole number of FIXED steps to consume the measured time.
      let ran = 0;
      while (acc >= stepMs && ran < MAX_CATCHUP_STEPS) {
        acc -= stepMs;
        ctx.tick = tick++;
        cb(ctx);
        ran++;
      }
      if (ran === MAX_CATCHUP_STEPS) { acc = 0; } // hitch: drop backlog, don't spiral

      // Lag-comp: snapshot tracked entities once per real frame (real clock),
      // matching setTimestep. `stepMs` sizes the history rings.
      const rw = this.#rewind;
      if (ran > 0 && rw !== undefined && rw.lastRecordedAt !== this.clock.elapsedTime) {
        rw.record(this.clock.elapsedTime, stepMs);
      }
    }, stepMs);
  }

  /** Server-side lag compensation, lazily created. @see allowRewindState */
  #rewind?: Rewind;

  /**
   * Enable server-side lag compensation: returns a {@link Rewind} that records the
   * position history of the entities you attach and automatically snapshots them
   * after each simulation tick. Attach the collections to rewind, then read past
   * positions (at a client's renderTime) in your hit tests.
   *
   * @example
   * ```ts
   * const rewind = this.allowRewindState({ maxRewindMs: 500 });
   * rewind.attachAll(this.state.enemies, { fields: ["x", "y"] });
   * // in a hit test:
   * const seenX = rewind.valueAt(enemy, renderTime, "x");
   * ```
   *
   * Needs a simulation loop ({@link setTimestep} / {@link setFixedTimestep})
   * — that's what drives the recording. Call `rewind.record()` yourself during a
   * tick to take over its timing for that tick.
   */
  public allowRewindState(opts?: RewindOptions): Rewind {
    this.#rewind = Rewind.get(this, opts);
    return this.#rewind;
  }

  /**
   * @deprecated Use `.patchRate=` instead.
   */
  public setPatchRate(milliseconds: number | null): void {
    this.patchRate = milliseconds;
  }

  /**
   * @deprecated Use `.state =` instead.
   */
  public setState(newState: ExtractRoomState<T>) {
    this.state = newState;
  }

  public setSerializer(serializer: Serializer<ExtractRoomState<T>>) {
    this._serializer = serializer;
  }

  public async setMetadata(meta: ExtractRoomMetadata<T>, persist: boolean = true) {
    this._listing.metadata = meta;

    if (persist && this._internalState === RoomInternalState.CREATED) {
      await matchMaker.driver.persist(this._listing);

      // emit metadata-change event to update lobby listing
      this._events.emit('metadata-change');
    }
  }

  public async setPrivate(bool: boolean = true, persist: boolean = true) {
    if (this._listing.private === bool) return;

    this._listing.private = bool;

    if (persist && this._internalState === RoomInternalState.CREATED) {
      await matchMaker.driver.persist(this._listing);
    }

    // emit visibility-change event to update lobby listing
    this._events.emit('visibility-change', bool);
  }

  /**
   * Update multiple matchmaking/listing properties at once with a single persist operation.
   * This is the recommended way to update room listing properties.
   *
   * @param updates - Object containing the properties to update
   *
   * @example
   * ```typescript
   * // Update multiple properties at once
   * await this.setMatchmaking({
   *   metadata: { difficulty: "hard", rating: 1500 },
   *   private: true,
   *   locked: true,
   *   maxClients: 10
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Update only metadata
   * await this.setMatchmaking({
   *   metadata: { status: "in_progress" }
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Merging with existing metadata: spread `this.metadata` yourself.
   * // `metadata` is always REPLACED (not merged) by setMatchmaking()/setMetadata().
   * await this.setMatchmaking({
   *   metadata: { ...this.metadata, round: this.metadata.round + 1 }
   * });
   * ```
   */
  public async setMatchmaking(updates: {
    metadata?: ExtractRoomMetadata<T>;
    private?: boolean;
    locked?: boolean;
    maxClients?: number;
    unlisted?: boolean;
    [key: string]: any;
  }) {
    for (const key in updates) {
      if (!updates.hasOwnProperty(key)) { continue; }

      switch (key) {
        case 'metadata': {
          this.setMetadata(updates.metadata, false);
          break;
        }

        case 'private': {
          this.setPrivate(updates.private, false);
          break;
        }

        case 'locked': {
          if (updates[key]) {
            // @ts-ignore
            this.lock.call(this, true);
            this._lockedExplicitly = true;
          } else {
            // @ts-ignore
            this.unlock.call(this, true);
            this._lockedExplicitly = false;
          }
          break;
        }

        case 'maxClients': {
          this.#_maxClients = updates.maxClients;
          this._listing.maxClients = updates.maxClients;

          const hasReachedMaxClients = this.hasReachedMaxClients();

          // unlock room if maxClients has been increased
          if (!this._lockedExplicitly && this.#_maxClientsReached && !hasReachedMaxClients) {
            this.#_maxClientsReached = false;
            this.#_locked = false;
            this._listing.locked = false;
            updates.locked = false;
          }

          // lock room if maxClients has been decreased
          if (hasReachedMaxClients) {
            this.#_maxClientsReached = true;
            this.#_locked = true;
            this._listing.locked = true;
            updates.locked = true;
          }

          break;
        }

        case 'clients': {
          console.warn("setMatchmaking() does not allow updating 'clients' property.");
          break;
        }

        default: {
          // Allow any other listing properties to be updated
          this._listing[key] = updates[key];
          break;
        }
      }
    }

    // Only persist if room is not CREATING
    if (this._internalState === RoomInternalState.CREATED) {
      await matchMaker.driver.update(this._listing, { $set: updates });

      // emit metadata-change event to update lobby listing
      this._events.emit('metadata-change');
    }
  }

  /**
   * Lock the room. This prevents new clients from joining this room.
   */
  public async lock() {
    // rooms locked internally aren't explicit locks.
    this._lockedExplicitly = (arguments[0] === undefined);

    // skip if already locked.
    if (this.#_locked) { return; }

    this.#_locked = true;

    // Only persist if this is an explicit lock/unlock
    if (this._lockedExplicitly) {
      await matchMaker.driver.update(this._listing, {
        $set: { locked: this.#_locked },
      });
    }

    this._events.emit('lock');
  }

  /**
   * Unlock the room. This allows new clients to join this room, if maxClients is not reached.
   */
  public async unlock() {
    // only internal usage passes arguments to this function.
    if (arguments[0] === undefined) {
      this._lockedExplicitly = false;
    }

    // skip if already locked
    if (!this.#_locked) { return; }

    this.#_locked = false;

    // Only persist if this is an explicit lock/unlock
    if (arguments[0] === undefined) {
      await matchMaker.driver.update(this._listing, {
        $set: { locked: this.#_locked },
      });
    }

    this._events.emit('unlock');
  }

  /**
   * @deprecated Use `client.send(...)` instead.
   */
  public send(client: Client, type: string | number, message: any, options?: ISendOptions): void;
  public send(client: Client, messageOrType: any, messageOrOptions?: any | ISendOptions, options?: ISendOptions): void {
    logger.warn('DEPRECATION WARNING: use client.send(...) instead of this.send(client, ...)');
    client.send(messageOrType, messageOrOptions, options);
  }

  /**
   * Broadcast a message to all connected clients.
   * @param type - The type of the message.
   * @param message - The message to broadcast.
   * @param options - The options for the broadcast.
   *
   * @example
   * ```typescript
   * this.broadcast('message', { message: 'Hello, world!' });
   * ```
   */
  public broadcast<K extends keyof ExtractRoomClient<T>['~messages'] & string | number>(
    type: K,
    ...args: MessageArgs<ExtractRoomClient<T>['~messages'][K], IBroadcastOptions>
  ) {
    const [message, options] = args;
    if (options && options.afterNextPatch) {
      delete options.afterNextPatch;
      this._afterNextPatchQueue.push(['broadcast', [type, ...args]]);
      return;
    }

    this.broadcastMessageType(type, message, options);
  }

  /**
   * Broadcast bytes (UInt8Arrays) to a particular room
   */
  public broadcastBytes(type: string | number, message: Uint8Array, options: IBroadcastOptions) {
    if (options && options.afterNextPatch) {
      delete options.afterNextPatch;
      this._afterNextPatchQueue.push(['broadcastBytes', arguments]);
      return;
    }

    this.broadcastMessageType(type as string, message, options);
  }

  /**
   * Checks whether mutations have occurred in the state, and broadcast them to all connected clients.
   */
  public broadcastPatch() {
    if (this.onBeforePatch) {
      this.onBeforePatch(this.state);
    }

    if (!this._simulationInterval) {
      this.clock.tick();
    }

    if (!this.state) {
      return false;
    }

    // When `defineInput()` was called, hand the serializer a fresh `sNow`
    // each tick. The per-client `lastTReceived` is read off the client at
    // encode time inside `applyPatches`.
    const hasChanges = this._serializer.applyPatches(
      this.clients,
      this.state,
      this._clientTimingEnabled ? { sNow: this.clock.elapsedTime } : undefined,
    );

    // broadcast messages enqueued for "after patch"
    this._dequeueAfterPatchMessages();

    return hasChanges;
  }

  /**
   * Register a message handler for a specific message type.
   * This method is used to handle messages sent by clients to the room.
   * @param messageType - The type of the message.
   * @param callback - The callback to call when the message is received.
   * @returns A function to unbind the callback.
   *
   * @example
   * ```typescript
   * this.onMessage('message', (client, message) => {
   *   console.log(message);
   * });
   * ```
   *
   * @example
   * ```typescript
   * const unbind = this.onMessage('message', (client, message) => {
   *   console.log(message);
   * });
   *
   * // Unbind the callback when no longer needed
   * unbind();
   * ```
   */
  public onMessage<T = any, C extends Client = ExtractRoomClient<T>>(
    messageType: '*',
    callback: (client: C, type: string | number, message: T) => void
  );
  public onMessage<T = any, C extends Client = ExtractRoomClient<T>>(
    messageType: string | number,
    callback: (client: C, message: T) => void,
  );
  public onMessage<T = any, C extends Client = ExtractRoomClient<T>>(
    messageType: string | number,
    validationSchema: StandardSchemaV1<T>,
    callback: (client: C, message: T) => void,
  );
  public onMessage<T = any>(
    _messageType: '*' | string | number,
    _validationSchema: StandardSchemaV1<T> | ((...args: any[]) => void),
    _callback?: (...args: any[]) => void,
  ) {
    const messageType = _messageType.toString();

    const validationSchema = (typeof _callback === 'function')
      ? _validationSchema as StandardSchemaV1<T>
      : undefined;

    const callback = (validationSchema === undefined)
      ? _validationSchema as (...args: any[]) => void
      : _callback;

    const removeListener = this.onMessageEvents.on(messageType, (this.onUncaughtException !== undefined)
      ? wrapTryCatch(callback, this.onUncaughtException.bind(this), OnMessageException, 'onMessage', false, _messageType)
      : callback);

    if (validationSchema !== undefined) {
      this.onMessageValidators[messageType] = validationSchema;
    }

    // returns a method to unbind the callback
    return () => {
      removeListener();
      if (this.onMessageEvents.events[messageType].length === 0) {
        delete this.onMessageValidators[messageType];
      }
    };
  }

  public onMessageBytes<T = any, C extends Client = ExtractRoomClient<T>>(
  // public onMessageBytes<T = any, C extends Client = TClient>(
    messageType: string | number,
    callback: (client: C, message: T) => void,
  );
  public onMessageBytes<T = any, C extends Client = ExtractRoomClient<T>>(
  // public onMessageBytes<T = any, C extends Client = TClient>(
    messageType: string | number,
    validationSchema: StandardSchemaV1<T>,
    callback: (client: C, message: T) => void,
  );
  public onMessageBytes<T = any>(
    _messageType: string | number,
    _validationSchema: StandardSchemaV1<T> | ((...args: any[]) => void),
    _callback?: (...args: any[]) => void,
  ) {
    const messageType = `_$b${_messageType}`;

    const validationSchema = (typeof _callback === 'function')
      ? _validationSchema as StandardSchemaV1<T>
      : undefined;

    const callback = (validationSchema === undefined)
      ? _validationSchema as (...args: any[]) => void
      : _callback;

    if (validationSchema !== undefined) {
      return this.onMessage(messageType, validationSchema as any, callback as any);
    } else {
      return this.onMessage(messageType, callback as any);
    }
  }

  // ---------------------------------------------------------------------------
  // Operator API — used by @colyseus/admin (and monitor in due course)
  // through `remoteRoomCall(roomId, methodName)`. Marked `@internal` because
  // they're framework-tooling primitives, not part of the game-code surface.
  // ---------------------------------------------------------------------------

  /**
   * Snapshot the room's live state for an inspector / admin UI. Includes:
   *
   *   roomId, name, maxClients, locked, elapsedTime (ms),
   *   metadata, clients (sessionId + per-client elapsed + userId when set),
   *   state (the schema/json the SDK would see),
   *   stateSize (bytes of the encoded full state, or 0 when no serializer).
   *
   * The payload is intentionally plain JSON — `remoteRoomCall` serializes
   * the return value across process boundaries.
   *
   * @internal Operator-only. Game code should not call this.
   */
  public getInspectorView(): {
    roomId: string;
    name: string;
    clients: number;
    maxClients: number;
    locked: boolean;
    elapsedTime: number;
    metadata: any;
    clientList: Array<{
      sessionId: string;
      userId: string | null;
      userEmail: string | null;
      elapsedTime: number;
    }>;
    state: any;
    stateSize: number;
  } {
    const elapsed = this.clock.elapsedTime;
    return {
      roomId: this.roomId,
      name: this.roomName,
      clients: this.clients.length,
      maxClients: this.maxClients,
      locked: this.#_locked,
      elapsedTime: elapsed,
      metadata: this.metadata ?? null,
      // Cast through `unknown`: `ExtractRoomClient<T>` vs `Client & ClientPrivate`
      // don't structurally overlap (the user's `client` generic may carry a
      // narrower userData/auth shape), but the runtime objects we walk here
      // always have the private join-time field. The narrow per-property
      // `(c as any)` reads below keep the cast scoped.
      //
      // userId / userEmail read straight off `client.auth` — the JWT
      // payload @colyseus/auth's default onAuth decodes carries both
      // when the user has them on file. Saves the admin a per-client
      // database round-trip; falls back to null when the client signed
      // in anonymously (or with a custom onAuth that returns a shape
      // without those fields).
      clientList: (this.clients as unknown as ReadonlyArray<Client & ClientPrivate>).map((c) => {
        const auth = (c as any).auth;
        return {
          sessionId: c.sessionId,
          userId: ((c as any).userId ?? auth?.id) ?? null,
          userEmail: auth?.email ?? null,
          elapsedTime: elapsed - ((c as any)._joinedAt ?? elapsed),
        };
      }),
      state: this.state ?? null,
      stateSize: this.#_inspectorStateSize(),
    };
  }

  /**
   * Force-disconnect a single client by sessionId. No-op when the client
   * isn't connected (idempotent — the caller doesn't need to race-check).
   *
   * @internal Operator-only. Game code disconnects clients by calling
   *   `.leave()` on the Client object directly.
   */
  public kickClient(sessionId: string, closeCode: number = CloseCode.CONSENTED, reason?: string): void {
    // Same `unknown` indirection as in `getInspectorView` above —
    // ExtractRoomClient<T> doesn't structurally include ClientPrivate.
    for (const client of this.clients as unknown as ReadonlyArray<Client & ClientPrivate>) {
      if (client.sessionId === sessionId) {
        this.#_forciblyCloseClient(client as ExtractRoomClient<T> & ClientPrivate, closeCode, reason);
        return;
      }
    }
  }

  /**
   * Best-effort byte size of the current full state. Falls back to `0`
   * when the room has no serializer or the serializer can't produce a
   * payload (raw rooms, very-early-onCreate, etc.). The serializer
   * detection mirrors `@colyseus/monitor`'s — we read whichever buffer
   * is available across schema v2 and v3.
   */
  #_inspectorStateSize(): number {
    const ser = this._serializer as any;
    if (!ser) { return 0; }
    const hasState = ser.encoder || ser.state;
    if (!hasState) { return 0; }
    try {
      const full = ser.getFullState?.();
      if (!full) { return 0; }
      // Buffer / Uint8Array have `byteLength`; raw arrays have `length`.
      return (full as any).byteLength ?? (full as any).length ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Disconnect all connected clients, and then dispose the room.
   *
   * @param closeCode WebSocket close code (default = 4000, which is a "consented leave")
   * @returns Promise<void>
   */
  public disconnect(closeCode: number = CloseCode.CONSENTED): Promise<any> {
    // skip if already disposing
    if (this._internalState === RoomInternalState.DISPOSING) {
      return Promise.resolve(`disconnect() ignored: room (${this.roomId}) is already disposing.`);

    } else if (this._internalState === RoomInternalState.CREATING) {
      throw new Error("cannot disconnect during onCreate()");
    }

    this._internalState = RoomInternalState.DISPOSING;
    matchMaker.driver.remove(this._listing.roomId);

    this.#_autoDispose = true;

    const delayedDisconnection = new Promise<void>((resolve) =>
      this._events.once('disconnect', () => resolve()));

    // reject pending reconnections
    this._rejectPendingReconnections("disconnecting");

    let numClients = this.clients.length;
    if (numClients > 0) {
      // clients may have `async onLeave`, room will be disposed after they're fulfilled
      while (numClients--) {
        this.#_forciblyCloseClient(this.clients[numClients] as ExtractRoomClient<T> & ClientPrivate, closeCode);
      }

    } else {
      // no clients connected, dispose immediately.
      this._events.emit('dispose');
    }

    return delayedDisconnection;
  }

  private _rejectPendingReconnections(message: string) {
    for (const [_, reconnection] of Object.values(this._reconnections)) {
      reconnection.reject(new ServerError(CloseCode.NORMAL_CLOSURE, message));
      // Suppress unhandled rejection — expected during shutdown/devMode
      // restart, handled downstream by _onLeave's .catch() handler.
      reconnection.catch(() => {});
    }
  }

  private async _onJoin(
    client: ExtractRoomClient<T> & ClientPrivate,
    authContext: AuthContext,
    connectionOptions?: { reconnectionToken?: string, skipHandshake?: boolean }
  ) {
    const sessionId = client.sessionId;

    // generate unique private reconnection token
    // (each new reconnection receives a new reconnection token)
    client.reconnectionToken = generateId();

    // Allocate per-client input instance + decoder if the Room called `defineInput()`.
    // Done early so onJoin can reference room.input(sessionId).latest.
    if (this._inputOptions !== undefined) {
      client._input = new this._inputOptions.ctor();
      client._inputDecoder = new InputDecoder(client._input);
      // Buffer is opt-in via bufferMaxSize > 0 (rollback / lockstep).
      const maxSize = this._inputOptions.bufferMaxSize;
      if (maxSize > 0) {
        client._inputBuffer = new InputBufferImpl(maxSize, this._inputOptions.seqField);
      }
      client._inputAccessor = new InputAccessorImpl(client);
    }

    if (this._reservedSeatTimeouts[sessionId]) {
      clearTimeout(this._reservedSeatTimeouts[sessionId]);
      delete this._reservedSeatTimeouts[sessionId];
    }

    // clear auto-dispose timeout.
    if (this._autoDisposeTimeout) {
      clearTimeout(this._autoDisposeTimeout);
      this._autoDisposeTimeout = undefined;
    }

    //
    // user may be trying to reconnect while the old connection is still open (stale)
    // (e.g. during network switches, where the old connection is still open while a new reconnection attempt is being made)
    //
    if (
      this._reservedSeats[sessionId] === undefined &&
      connectionOptions?.reconnectionToken &&
      this.clients.getById(sessionId)?.reconnectionToken === connectionOptions.reconnectionToken
    ) {
      debugMatchMaking('attempting to reconnect client with a stale previous connection - sessionId: \'%s\', roomId: \'%s\'', client.sessionId, this.roomId);
      this._reconnectionAttempts[connectionOptions.reconnectionToken] = new Deferred();

      const reconnectionAttemptTimeout = setTimeout(() => {
        this._reconnectionAttempts[connectionOptions.reconnectionToken]?.reject(new ServerError(CloseCode.MAY_TRY_RECONNECT, 'Reconnection attempt timed out'));
      }, this.seatReservationTimeout * 1000);

      const cleanup = () => {
        clearTimeout(reconnectionAttemptTimeout);
        delete this._reconnectionAttempts[connectionOptions.reconnectionToken];
      }

      await this._reconnectionAttempts[connectionOptions.reconnectionToken]
        .then(() => cleanup())
        .catch(() => cleanup());

      if (!this._reservedSeats[sessionId]) {
        throw new ServerError(ErrorCode.MATCHMAKE_EXPIRED, "failed to reconnect");
      }
    }

    // get seat reservation options and clear it
    const [joinOptions, authData, isConsumed, isWaitingReconnection] = this._reservedSeats[sessionId];

    //
    // TODO: remove this check on 1.0.0
    // - the seat reservation is used to keep track of number of clients and their pending seats (see `hasReachedMaxClients`)
    // - when we fully migrate to static onAuth(), the seat reservation can be removed immediately here
    // - if async onAuth() is in use, the seat reservation is removed after onAuth() is fulfilled.
    // - mark reservation as "consumed"
    //
    if (isConsumed) {
      throw new ServerError(ErrorCode.MATCHMAKE_EXPIRED, "already consumed");
    }
    this._reservedSeats[sessionId][2] = true; // flag seat reservation as "consumed"
    debugMatchMaking('consuming seat reservation, sessionId: \'%s\' (roomId: %s)', client.sessionId, this.roomId);

    // share "after next patch queue" reference with every client.
    client._afterNextPatchQueue = this._afterNextPatchQueue;

    // add temporary callback to keep track of disconnections during `onJoin`.
    client.ref['onleave'] = (_) => client.state = ClientState.LEAVING;
    client.ref.once('close', client.ref['onleave']);

    if (isWaitingReconnection) {
      const reconnectionToken = connectionOptions?.reconnectionToken;
      if (reconnectionToken && this._reconnections[reconnectionToken]?.[0] === sessionId) {
        this.clients.push(client);

        //
        // await for reconnection:
        // (end user may customize the reconnection token at this step)
        //
        await this._reconnections[reconnectionToken]?.[1].resolve(client);

        try {
          if (this.onReconnect) {
            await this.onReconnect(client);
          }

          // FIXME: we shouldn't rely on WebSocket specific API here (make it transport agnostic)
          if (client.readyState !== WebSocket.OPEN) {
            throw new Error("reconnection denied");
          }

          // client.leave() may have been called during onReconnect()
          if (client.state === ClientState.RECONNECTING) {
            // switch client state from RECONNECTING to JOINING
            // (to allow to attach messages to the client again)
            client.state = ClientState.JOINING;
          }

        } catch (e) {
          await this._onLeave(client, CloseCode.FAILED_TO_RECONNECT);
          throw e;
        }

      } else {
        const errorMessage = (process.env.NODE_ENV === 'production')
          ? "already consumed" // trick possible fraudsters...
          : "bad reconnection token" // ...or developers
        throw new ServerError(ErrorCode.MATCHMAKE_EXPIRED, errorMessage);
      }

    } else {
      try {
        if (authData) {
          client.auth = authData;

        } else if (this.onAuth !== Room.prototype.onAuth) {
          try {
            client.auth = await this.onAuth(client, joinOptions, authContext);

            if (!client.auth) {
              throw new ServerError(ErrorCode.AUTH_FAILED, 'onAuth failed');
            }

          } catch (e) {
            // remove seat reservation
            delete this._reservedSeats[sessionId];
            await this.#_decrementClientCount();
            throw e;
          }
        }

        //
        // On async onAuth, client may have been disconnected.
        //
        if (client.state === ClientState.LEAVING) {
          throw new ServerError(CloseCode.WITH_ERROR, 'already disconnected');
        }

        this.clients.push(client);

        //
        // Flag sessionId as non-enumarable so hasReachedMaxClients() doesn't count it
        // (https://github.com/colyseus/colyseus/issues/726)
        //
        Object.defineProperty(this._reservedSeats, sessionId, {
          value: this._reservedSeats[sessionId],
          enumerable: false,
        });

        if (this.onJoin) {
          // TODO: deprecate auth as 3rd argument on Colyseus 1.0
          await this.onJoin(client, joinOptions, client.auth);
        }

        // @ts-ignore: client left during `onJoin`, call _onLeave immediately.
        if (client.state === ClientState.LEAVING) {
          throw new ServerError(ErrorCode.MATCHMAKE_UNHANDLED, "early_leave");

        } else {
          // remove seat reservation
          delete this._reservedSeats[sessionId];

          // emit 'join' to room handler
          this._events.emit('join', client);
        }

      } catch (e: any) {
        await this._onLeave(client, CloseCode.WITH_ERROR);

        // remove seat reservation
        delete this._reservedSeats[sessionId];

        // make sure an error code is provided.
        if (!e.code) {
          e.code = ErrorCode.APPLICATION_ERROR;
        }

        throw e;
      }
    }

    // state might already be ClientState.LEAVING here
    if (client.state === ClientState.JOINING) {
      client.ref.removeListener('close', client.ref['onleave']);

      // only bind _onLeave after onJoin has been successful
      client.ref['onleave'] = this._onLeave.bind(this, client);
      client.ref.once('close', client.ref['onleave']);

      // allow client to send messages after onJoin has succeeded.
      client.ref.on('message', this._onMessage.bind(this, client));

      // Append input reflection as a tagged section when the room declared
      // input. The SDK uses these bytes to materialize a constructor for
      // `conn.input()` calls that don't pass an explicit `type`.
      let extraSections: Array<{ tag: number; bytes: Uint8Array }> | undefined;
      if (!connectionOptions?.skipHandshake && this._inputOptions !== undefined) {
        const inputBytes = _inputReflectionCache.get(this._inputOptions.ctor);
        if (inputBytes !== undefined) {
          extraSections = [{ tag: HandshakeSection.INPUT_REFLECTION, bytes: inputBytes }];
        }
        // [flags uint8][tickRate varint?][patchRate varint?]: renderTime → client
        // auto-stamps inputs; tickRate (Hz) → predict at dt=1/tickRate; patchRate (ms)
        // → reconcile cadence for smoothing. Varints in bit order. See InputFlags.
        const tickRate = this._inputOptions.tickRate;
        const patchRate = (typeof this.patchRate === "number" && this.patchRate > 0)
          ? Math.round(this.patchRate) : undefined;
        if (this._inputOptions.renderTime || tickRate || patchRate) {
          let flags = 0;
          if (this._inputOptions.renderTime) { flags |= InputFlags.RENDER_TIME; }
          if (tickRate) { flags |= InputFlags.FIXED_TIMESTEP; }
          if (patchRate) { flags |= InputFlags.PATCH_RATE; }
          const buf = new Uint8Array(16);
          const sit = { offset: 0 };
          buf[sit.offset++] = flags;
          if (tickRate) { encode.number(buf, tickRate, sit); }
          if (patchRate) { encode.number(buf, patchRate, sit); }
          (extraSections ??= []).push({
            tag: HandshakeSection.INPUT_OPTIONS,
            bytes: buf.subarray(0, sit.offset),
          });
        }
      }

      // confirm room id that matches the room name requested to join
      client.raw(getMessageBytes[Protocol.JOIN_ROOM](
        client.reconnectionToken,
        this._serializer.id,
        /**
         * if skipHandshake is true, we don't need to send the handshake
         * (in case client already has handshake data)
         */
        (connectionOptions?.skipHandshake)
          ? undefined
          : this._serializer.handshake && this._serializer.handshake(),
        extraSections,
      ));
    }
  }

  /**
   * Allow the specified client to reconnect into the room. Must be used inside `onLeave()` method.
   * If seconds is provided, the reconnection is going to be cancelled after the provided amount of seconds.
   *
   * @param client - The client that is allowed to reconnect into the room.
   * @param seconds - The time in seconds that the client is allowed to reconnect into the room.
   *
   * @returns Deferred<Client> - The differed is a promise like type.
   *  This type can forcibly reject the promise by calling `.reject()`.
   *
   * @example
   * ```typescript
   * onDrop(client: Client, code: CloseCode) {
   *   // Allow the client to reconnect into the room with a 15 seconds timeout.
   *   this.allowReconnection(client, 15);
   * }
   * ```
   */
  public allowReconnection(previousClient: Client, seconds: number | "manual"): Deferred<Client> {
    //
    // Return rejected promise if client has never fully JOINED.
    //
    // (having `_enqueuedMessages !== undefined` means that the client has never been at "ClientState.JOINED" state)
    //
    if ((previousClient as unknown as ClientPrivate)._enqueuedMessages !== undefined) {
      // @ts-ignore
      return Promise.reject(new ServerError("not joined"));
    }

    if (seconds === undefined) { // TODO: remove this check
      console.warn("DEPRECATED: allowReconnection() requires a second argument. Using \"manual\" mode.");
      seconds = "manual";
    }

    if (seconds === "manual") {
      seconds = Infinity;
    }

    if (this._internalState === RoomInternalState.DISPOSING) {
      // @ts-ignore
      return Promise.reject(new Error("disposing"));
    }

    const sessionId = previousClient.sessionId;
    const reconnectionToken = previousClient.reconnectionToken;

    //
    // prevent duplicate .allowReconnection() calls
    // (may occur during network switches, where the old connection is still
    // open while a new reconnection attempt is being made)
    //
    if (this._reconnections[reconnectionToken]) {
      debugMatchMaking('skipping duplicate .allowReconnection() call for client - sessionId: \'%s\', roomId: \'%s\'', sessionId, this.roomId);
      return this._reconnections[reconnectionToken][1];
    }

    this._reserveSeat(sessionId, true, previousClient.auth, seconds, true);

    // keep reconnection reference in case the user reconnects into this room.
    const reconnection = new Deferred<Client & ClientPrivate>();
    this._reconnections[reconnectionToken] = [sessionId, reconnection];

    if (seconds !== Infinity) {
      // expire seat reservation after timeout
      this._reservedSeatTimeouts[sessionId] = setTimeout(() =>
        reconnection.reject(false), seconds * 1000);
    }

    const cleanup = () => {
      delete this._reconnections[reconnectionToken];
      delete this._reservedSeats[sessionId];
      delete this._reservedSeatTimeouts[sessionId];
    };

    reconnection.then((newClient) => {
      newClient.auth = previousClient.auth;
      newClient.userData = previousClient.userData;
      newClient.view = previousClient.view;
      newClient.state = ClientState.RECONNECTING;

      // for convenience: populate previous client reference with new client
      previousClient.state = ClientState.RECONNECTED;
      previousClient.ref = newClient.ref;
      previousClient.reconnectionToken = newClient.reconnectionToken;
      clearTimeout(this._reservedSeatTimeouts[sessionId]);

    }, () => {
      this.resetAutoDisposeTimeout();

    }).finally(() => {
      cleanup();
    });

    //
    // If a reconnection attempt is already in progress, resolve it
    //
    // This step ensures reconnection works when network changes (e.g.,
    // switching Wi-Fi), as the original connection may still be open while a
    // new reconnection attempt is being made.
    //
    if (this._reconnectionAttempts[reconnectionToken] !== undefined) {
      debugMatchMaking('resolving reconnection attempt for client - sessionId: \'%s\', roomId: \'%s\'', sessionId, this.roomId);
      this._reconnectionAttempts[reconnectionToken].resolve(true);
    }

    return reconnection;
  }

  private resetAutoDisposeTimeout(timeoutInSeconds: number = 1) {
    clearTimeout(this._autoDisposeTimeout);

    if (!this.#_autoDispose) {
      return;
    }

    this._autoDisposeTimeout = setTimeout(() => {
      this._autoDisposeTimeout = undefined;
      this.#_disposeIfEmpty();
    }, timeoutInSeconds * 1000);
  }

  private broadcastMessageType(type: number | string, message?: any | Uint8Array, options: IBroadcastOptions = {}) {
    debugMessage("broadcast: %O (roomId: %s)", message, this.roomId);

    const encodedMessage = (message instanceof Uint8Array)
      ? getMessageBytes.raw(Protocol.ROOM_DATA_BYTES, type, undefined, message)
      : getMessageBytes.raw(Protocol.ROOM_DATA, type, message)

    const except = (typeof (options.except) !== "undefined")
      ? Array.isArray(options.except)
        ? options.except
        : [options.except]
      : undefined;

    let numClients = this.clients.length;
    while (numClients--) {
      const client = this.clients[numClients];

      if (!except || !except.includes(client)) {
        client.enqueueRaw(encodedMessage);
      }
    }
  }

  // Encode and enqueue a ROOM_RESPONSE for a client request. If the client has
  // already left, `enqueueRaw` is a no-op — no response is needed.
  #replyToRequest(client: Client, requestId: number, status: ResponseStatus, payload?: any) {
    debugMessage("response #%d: status=%d -> %j (roomId: %s)", requestId, status, payload, this.roomId);
    client.enqueueRaw(getMessageBytes[Protocol.ROOM_RESPONSE](requestId, status, payload));
  }

  private sendFullState(client: Client): void {
    client.raw(this._serializer.getFullState(
      client,
      this._clientTimingEnabled ? { sNow: this.clock.elapsedTime } : undefined,
    ));
  }

  private _dequeueAfterPatchMessages() {
    const length = this._afterNextPatchQueue.length;

    if (length > 0) {
      for (let i = 0; i < length; i++) {
        const [target, args] = this._afterNextPatchQueue[i];

        if (target === "broadcast") {
          this.broadcast.apply(this, args as any);

        } else {
          (target as Client).raw.apply(target, args as any);
        }
      }

      // new messages may have been added in the meantime,
      // let's splice the ones that have been processed
      this._afterNextPatchQueue.splice(0, length);
    }
  }

  private async _reserveSeat(
    sessionId: string,
    joinOptions: any = true,
    authData: any = undefined,
    seconds: number = this.seatReservationTimeout,
    allowReconnection: boolean = false,
    devModeReconnectionToken?: string,
  ) {
    if (!allowReconnection && this.hasReachedMaxClients()) {
      return false;
    }

    debugMatchMaking(
      'reserving seat on \'%s\' - sessionId: \'%s\', roomId: \'%s\', processId: \'%s\'',
      this.roomName, sessionId, this.roomId, matchMaker.processId,
    );

    this._reservedSeats[sessionId] = [joinOptions, authData, false, allowReconnection];

    if (!allowReconnection) {
      await this.#_incrementClientCount();

      this._reservedSeatTimeouts[sessionId] = setTimeout(async () => {
        delete this._reservedSeats[sessionId];
        delete this._reservedSeatTimeouts[sessionId];
        await this.#_decrementClientCount();
      }, seconds * 1000);

      this.resetAutoDisposeTimeout(seconds);
    }

    if (devModeReconnectionToken) {
      const reconnection = new Deferred<Client & ClientPrivate>();
      this._reconnections[devModeReconnectionToken] = [sessionId, reconnection];

      // If the client doesn't reconnect within the timeout, call onLeave
      // so the room can clean up stale state (e.g. delete player data).
      clearTimeout(this._reservedSeatTimeouts[sessionId]);
      this._reservedSeatTimeouts[sessionId] = setTimeout(async () => {
        if (!this._reconnections[devModeReconnectionToken]) { return; }

        delete this._reconnections[devModeReconnectionToken];
        delete this._reservedSeats[sessionId];
        delete this._reservedSeatTimeouts[sessionId];

        if (!allowReconnection) {
          await this.#_decrementClientCount();
        }

        this.onLeave?.({ sessionId } as any, CloseCode.MAY_TRY_RECONNECT);
      }, seconds * 1000);
    }

    return true;
  }

  private async _reserveMultipleSeats(
    multipleSessionIds: string[],
    multipleJoinOptions: any = true,
    multipleAuthData: any = undefined,
    seconds: number = this.seatReservationTimeout,
  ) {
    let promises: Promise<boolean>[] = [];

    for (let i = 0; i < multipleSessionIds.length; i++) {
      promises.push(this._reserveSeat(multipleSessionIds[i], multipleJoinOptions[i], multipleAuthData[i], seconds));
    }

    return await Promise.all(promises);
  }

  #_disposeIfEmpty() {
    const willDispose = (
      this.#_onLeaveConcurrent === 0 && // no "onLeave" calls in progress
      this.#_autoDispose &&
      this._autoDisposeTimeout === undefined &&
      this.clients.length === 0 &&
      Object.keys(this._reservedSeats).length === 0
    );

    if (willDispose) {
      this._events.emit('dispose');
    }

    return willDispose;
  }

  async #_dispose(): Promise<any> {
    this._internalState = RoomInternalState.DISPOSING;

    // If the room is still CREATING, the roomId is not yet set.
    if (this._listing?.roomId !== undefined) {
      await matchMaker.driver.remove(this._listing.roomId);
    }

    let userReturnData;
    if (this.onDispose) {
      userReturnData = this.onDispose();
    }

    if (this.#_patchInterval) {
      clearInterval(this.#_patchInterval);
      this.#_patchInterval = undefined;
    }

    if (this._simulationInterval) {
      clearInterval(this._simulationInterval);
      this._simulationInterval = undefined;
    }

    if (this._autoDisposeTimeout) {
      clearInterval(this._autoDisposeTimeout);
      this._autoDisposeTimeout = undefined;
    }

    // clear all timeouts/intervals + force to stop ticking
    this.clock.clear();
    this.clock.stop();

    return await (userReturnData || Promise.resolve());
  }

  /**
   * After the decoder has mutated `client._input`, push a clone into the
   * per-client buffer (when buffering is enabled). Honors
   * `inputOptions.seqField` for dedupe of redundant frames.
   */
  #captureInput(client: ClientPrivate, renderTime: number = 0) {
    const buf = client._inputBuffer;
    if (!buf) { return; } // no consumer registered — skip the clone allocation
    const inst = client._input!;
    const seqField = this._inputOptions?.seqField;
    if (seqField !== undefined) {
      const value = (inst as any)[seqField] as number;
      if (typeof value === 'number' && !buf.accept(value)) { return; }
    }
    buf.push(inst.clone() as any, renderTime);
  }

  private _onMessage(client: ExtractRoomClient<T> & ClientPrivate, buffer: Buffer) {
    // skip if client is on LEAVING state.
    if (client.state === ClientState.LEAVING) { return; }

    if (!buffer) {
      debugAndPrintError(`${this.roomName} (roomId: ${this.roomId}), couldn't decode message: ${buffer}`);
      return;
    }

    // reset message count every second
    if (this.clock.currentTime - client._lastMessageTime >= 1000) {
      client._numMessagesLastSecond = 0;
      client._lastMessageTime = this.clock.currentTime;
    } else if (++client._numMessagesLastSecond > this.maxMessagesPerSecond) {
      // drop client if it sends more messages than the maximum allowed per second
      debugMatchMaking('dropping client - sessionId: \'%s\' (roomId: %s), too many messages per second', client.sessionId, this.roomId);
      return this.#_forciblyCloseClient(client, CloseCode.WITH_ERROR);
    }

    const it: Iterator = { offset: 1 };
    // Strip modifier bits (e.g. ProtocolModifier.TIMED on a render-time input)
    // before dispatch; existing client→server codes set no modifiers.
    const code = buffer[0] & PROTOCOL_CODE_MASK;
    const modifiers = buffer[0] & PROTOCOL_MODIFIER_MASK;

    if (code === Protocol.ROOM_DATA) {
      const messageType = (decode.stringCheck(buffer, it))
        ? decode.string(buffer, it)
        : decode.number(buffer, it);

      let message;
      try {
        message = (buffer.byteLength > it.offset)
          ? unpack(buffer.subarray(it.offset, buffer.byteLength))
          : undefined;
        debugMessage("received: '%s' -> %j (roomId: %s)", messageType, message, this.roomId);

        // custom message validation
        if (this.onMessageValidators[messageType] !== undefined) {
          message = standardValidate(this.onMessageValidators[messageType], message);
        }

      } catch (e: any) {
        debugAndPrintError(e);
        client.leave(CloseCode.WITH_ERROR);
        return;
      }

      if (this.onMessageEvents.events[messageType]) {
        this.onMessageEvents.emit(messageType as string, client, message);

      } else if (this.onMessageEvents.events['*']) {
        this.onMessageEvents.emit('*', client, messageType, message);

      } else {
        this.onMessageFallbacks['__no_message_handler'](client, messageType, message);
      }

    } else if (code === Protocol.ROOM_REQUEST) {
      // A request reuses the same `onMessage(type, ...)` handlers as a plain
      // ROOM_DATA message — the only difference is the client opted in to a
      // reply (by passing a callback / using `room.request()`), so the wire
      // carries a `requestId` we must echo back. The handler's return value
      // (awaited) becomes the response payload.
      const requestId = decode.number(buffer, it);

      const messageType = (decode.stringCheck(buffer, it))
        ? decode.string(buffer, it)
        : decode.number(buffer, it);

      let message;
      try {
        message = (buffer.byteLength > it.offset)
          ? unpack(buffer.subarray(it.offset, buffer.byteLength))
          : undefined;
        debugMessage("request #%d: '%s' -> %j (roomId: %s)", requestId, messageType, message, this.roomId);

        // custom message validation (shared with the ROOM_DATA path)
        if (this.onMessageValidators[messageType] !== undefined) {
          message = standardValidate(this.onMessageValidators[messageType], message);
        }

      } catch (e: any) {
        // Reply with an error so the client's pending request settles instead
        // of timing out. (A plain ROOM_DATA would drop the client here, but a
        // request has a caller waiting on the other end.)
        debugAndPrintError(e);
        this.#replyToRequest(client, requestId, ResponseStatus.ERROR, toResponseError(e));
        return;
      }

      // A request is answered by the FIRST handler registered for its type.
      // `onMessageEvents.emit` would run every handler and discard returns, so
      // we invoke directly to capture the value. Wildcard ('*') handlers are
      // not eligible — their (client, type, message) shape has no response
      // contract — so a type with only a wildcard handler gets `no_handler`.
      const handler = this.onMessageEvents.events[messageType as string]?.[0];

      if (handler === undefined) {
        this.#replyToRequest(client, requestId, ResponseStatus.ERROR, {
          name: "no_handler",
          message: `room "${this.roomName}" has no onMessage("${messageType}") handler to answer this request.`,
        });
        return;
      }

      // `Promise.resolve().then(...)` normalizes sync throws and async
      // rejections into the same rejection path. When `onUncaughtException`
      // is configured the handler is wrapped (see `onMessage`) and swallows
      // its own errors, so the request resolves with `undefined` and the
      // exception is reported there instead of as an ERROR response.
      Promise.resolve().then(() => handler(client, message)).then(
        (response) => this.#replyToRequest(client, requestId, ResponseStatus.OK, response),
        (e) => {
          debugAndPrintError(e);
          this.#replyToRequest(client, requestId, ResponseStatus.ERROR, toResponseError(e));
        },
      );

    } else if (code === Protocol.ROOM_DATA_BYTES) {
      const messageType = (decode.stringCheck(buffer, it))
        ? decode.string(buffer, it)
        : decode.number(buffer, it);

      let message: any = buffer.subarray(it.offset, buffer.byteLength);
      debugMessage("received: '%s' -> %j (roomId: %s)", messageType, message, this.roomId);

      const bytesMessageType = `_$b${messageType}`;

      // custom message validation
      try {
        if (this.onMessageValidators[bytesMessageType] !== undefined) {
          message = standardValidate(this.onMessageValidators[bytesMessageType], message);
        }
      } catch (e: any) {
        debugAndPrintError(e);
        client.leave(CloseCode.WITH_ERROR);
        return;
      }

      if (this.onMessageEvents.events[bytesMessageType]) {
        this.onMessageEvents.emit(bytesMessageType, client, message);

      } else if (this.onMessageEvents.events['*']) {
        this.onMessageEvents.emit('*', client, messageType, message);

      } else {
        this.onMessageFallbacks['__no_message_handler'](client, messageType, message);
      }

    } else if (code === Protocol.ROOM_INPUT_RELIABLE) {
      if (client._inputDecoder) {
        // Optional [uint32 renderTime] prefix (TIMED bit) — the server-clock ms
        // the client was rendering the world at; surfaced as input.renderTime
        // for lag-compensated hit registration. `it` starts at offset 1, so the
        // body begins at `it.offset` (1 without the prefix, 5 with it).
        let renderTime = 0;
        if (modifiers & PROTOCOL_MODIFIER_MASK) {
          renderTime = decode.uint32(buffer, it);
        }
        try {
          client._inputDecoder.decode(buffer.subarray(it.offset));
        } catch (e: any) {
          debugAndPrintError(e);
          return;
        }
        client._lastInputReceivedAt = performance.now();
        // Counter mirrors the SDK's `#sentInputCount`; echoed in the
        // TIMED prefix as `lastInputSeq` so the client can compute RTT.
        client._receivedInputCount = (client._receivedInputCount ?? 0) + 1;
        this.#captureInput(client, renderTime);
      }

    } else if (code === Protocol.ROOM_INPUT_UNRELIABLE) {
      if (client._inputDecoder) {
        try {
          client._inputDecoder.decodeAll(buffer.subarray(1), () => this.#captureInput(client));
        } catch (e: any) {
          debugAndPrintError(e);
          return;
        }
        client._lastInputReceivedAt = performance.now();
      }

    } else if (code === Protocol.JOIN_ROOM && client.state === ClientState.JOINING) {
      // join room has been acknowledged by the client
      client.state = ClientState.JOINED;
      client._joinedAt = this.clock.elapsedTime;

      // send current state when new client joins the room
      if (this.state) {
        this.sendFullState(client);
      }

      // dequeue messages sent before client has joined effectively (on user-defined `onJoin`)
      if (client._enqueuedMessages.length > 0) {
        client._enqueuedMessages.forEach((enqueued) => client.raw(enqueued));
      }
      delete client._enqueuedMessages;

    } else if (code === Protocol.PING) {
      client.raw(getMessageBytes[Protocol.PING]());

    } else if (code === Protocol.LEAVE_ROOM) {
      this.#_forciblyCloseClient(client, CloseCode.CONSENTED);
    }
  }

  #_forciblyCloseClient(client: ExtractRoomClient<T> & ClientPrivate, closeCode: number, reason?: string) {
    // stop receiving messages from this client
    client.ref.removeAllListeners('message');

    // prevent "onLeave" from being called twice if player asks to leave
    client.ref.removeListener('close', client.ref['onleave']);

    // only effectively close connection when "onLeave" is fulfilled
    this._onLeave(client, closeCode).then(() => (client as any).leave(closeCode, reason));
  }

  private async _onLeave(client: ExtractRoomClient<T>, code?: number): Promise<any> {
    // reconnecting check is required here to allow user to deny reconnection via onReconnect()
    const method = (code === CloseCode.CONSENTED || client.state === ClientState.RECONNECTING)
      ? this.onLeave
      : (this.onDrop || this.onLeave);

    client.state = ClientState.LEAVING;

    if (!this.clients.delete(client)) {
      // skip if client already left the room
      return;
    }

    if (method) {
      debugMatchMaking(`${method.name}, sessionId: \'%s\' (close code: %d, roomId: %s)`, client.sessionId, code, this.roomId);

      try {
        this.#_onLeaveConcurrent++;
        await method.call(this, client, code);

      } catch (e: any) {
        const serverError = (!(e instanceof ServerError))
          ? new ServerError(CloseCode.WITH_ERROR, `${method.name} error`, { cause: e })
          : e;
        debugAndPrintError(serverError);

      } finally {
        this.#_onLeaveConcurrent--;
      }
    }

    // check for manual "reconnection" flow
    if (this._reconnections[client.reconnectionToken]) {
      this._reconnections[client.reconnectionToken][1].catch(async () => {
        await this.#_onAfterLeave(client, code, method === this.onDrop);
      });

      // @ts-ignore (client.state may be modified at onLeave())
    } else if (client.state !== ClientState.RECONNECTED) {
      await this.#_onAfterLeave(client, code, method === this.onDrop);
    }
  }

  async #_onAfterLeave(client: ExtractRoomClient<T>, code?: number, isDrop: boolean = false) {
    if (isDrop && this.onLeave) {
      await this.onLeave(client, code);
    }

    // try to dispose immediately if client reconnection isn't set up.
    const willDispose = await this.#_decrementClientCount();

    // trigger 'leave' only if seat reservation has been fully consumed
    if (this._reservedSeats[client.sessionId] === undefined) {
      this._events.emit('leave', client, willDispose);
    }
  }

  async #_incrementClientCount() {
    // lock automatically when maxClients is reached
    if (!this.#_locked && this.hasReachedMaxClients()) {
      this.#_maxClientsReached = true;

      // @ts-ignore
      this.lock.call(this, true);
    }

    await matchMaker.driver.update(this._listing, {
      $inc: { clients: 1 },
      $set: { locked: this.#_locked },
    });
  }

  async #_decrementClientCount() {
    const willDispose = this.#_disposeIfEmpty();

    if (this._internalState === RoomInternalState.DISPOSING) {
      return true;
    }

    // unlock if room is available for new connections
    if (!willDispose) {
      if (this.#_maxClientsReached && !this._lockedExplicitly) {
        this.#_maxClientsReached = false;

        // @ts-ignore
        this.unlock.call(this, true);
      }

      // update room listing cache
      await matchMaker.driver.update(this._listing, {
        $inc: { clients: -1 },
        $set: { locked: this.#_locked },
      });
    }

    return willDispose;
  }

  #registerUncaughtExceptionHandlers() {
    const onUncaughtException = this.onUncaughtException.bind(this);
    const originalSetTimeout = this.clock.setTimeout;
    this.clock.setTimeout = (cb, timeout, ...args) => {
      return originalSetTimeout.call(this.clock, wrapTryCatch(cb, onUncaughtException, TimedEventException, 'setTimeout'), timeout, ...args);
    };

    const originalSetInterval = this.clock.setInterval;
    this.clock.setInterval = (cb, timeout, ...args) => {
      return originalSetInterval.call(this.clock, wrapTryCatch(cb, onUncaughtException, TimedEventException, 'setInterval'), timeout, ...args);
    };

    if (this.onCreate !== undefined) {
      this.onCreate = wrapTryCatch(this.onCreate.bind(this), onUncaughtException, OnCreateException, 'onCreate', true);
    }

    if (this.onAuth !== undefined) {
      this.onAuth = wrapTryCatch(this.onAuth.bind(this), onUncaughtException, OnAuthException, 'onAuth', true);
    }

    if (this.onJoin !== undefined) {
      this.onJoin = wrapTryCatch(this.onJoin.bind(this), onUncaughtException, OnJoinException, 'onJoin', true);
    }

    if (this.onLeave !== undefined) {
      this.onLeave = wrapTryCatch(this.onLeave.bind(this), onUncaughtException, OnLeaveException, 'onLeave', true);
    }

    if (this.onDrop !== undefined) {
      this.onDrop = wrapTryCatch(this.onDrop.bind(this), onUncaughtException, OnDropException, 'onDrop', true);
    }

    if (this.onReconnect !== undefined) {
      this.onReconnect = wrapTryCatch(this.onReconnect.bind(this), onUncaughtException, OnReconnectException, 'onReconnect', true);
    }

    if (this.onDispose !== undefined) {
      this.onDispose = wrapTryCatch(this.onDispose.bind(this), onUncaughtException, OnDisposeException, 'onDispose');
    }
  }

}