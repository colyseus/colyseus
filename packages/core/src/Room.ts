import { decode, type Iterator, $changes } from '@colyseus/schema';
import { validateSubSteps, type InputAPI, type DefineInputOptions, type IdleDeclared } from './input/InputBuffer.ts';
import { RoomInput } from './input/RoomInput.ts';
import { RoomMessages } from './RoomMessages.ts';
import { Rewind, type RewindOptions } from './Rewind.ts';
export { type InputAccessor, type InputAPI, type InputOptions, type ConsumeOptions, type IdleInput, type IdleContext, type SanitizeInput, type NumericFieldsOf, type DefineInputOptions, type IdleDeclared } from './input/InputBuffer.ts';

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
import { isDevMode } from './utils/DevMode.ts';

import { debugAndPrintError, debugMatchMaking, debugMessage } from './Debug.ts';
import { ServerError } from './errors/ServerError.ts';
import { ClientState, type AuthContext, type Client, type ClientPrivate, ClientArray, type ISendOptions, type MessageArgs } from './Transport.ts';
import { type RoomMethodName, OnAuthException, OnCreateException, OnDisposeException, OnDropException, OnJoinException, OnLeaveException, OnReconnectException, type RoomException, TimestepException, TimedEventException } from './errors/RoomExceptions.ts';

import { type StandardSchemaV1 } from './utils/StandardSchema.ts';
import * as matchMaker from './MatchMaker.ts';

import {
  CloseCode,
  ErrorCode,
  Protocol,
  PROTOCOL_CODE_MASK,
  PROTOCOL_MODIFIER_MASK,
  type MessageHandlerWithFormat as SharedMessageHandlerWithFormat,
  type MessageHandler as SharedMessageHandler,
  type Messages as SharedMessages,
  type MessageContext,
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
  /**
   * Physics sub-steps per fixed step (≥ 1; `1` unless declared via
   * `setFixedTimestep(..., { subSteps })`). Run your engine `subSteps` times at
   * {@link subDt} inside each step — `for (let i = 0; i < ctx.subSteps; i++)
   * world.step(ctx.subDt)` — to integrate physics at `tickRate * subSteps` Hz
   * while inputs flow at `tickRate`. The same numbers are cascaded to predicting
   * clients (their step context carries identical `subSteps`/`subDt`), so the
   * sub-stepped trajectory replays bit-identically.
   */
  readonly subSteps: number;
  /** Physics sub-step in SECONDS (`dt / subSteps`); equals {@link dt} when
   *  `subSteps` is 1, so the loop above is valid for every room. */
  readonly subDt: number;
  /** Physics sub-step in MILLISECONDS (`dtMs / subSteps`). */
  readonly subDtMs: number;
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
  handler: (this: This, client: Client, message: StandardSchemaV1.InferOutput<T>, ctx: MessageContext) => unknown
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
  /** @internal Message-routing layer: handler registry + user-message decode/dispatch. */
  #_messages = new RoomMessages(this);

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

  // Re-expose the registry for @colyseus/playground introspection and
  // @colyseus/testing handler-swapping (both reach in via bracket access).
  private get onMessageEvents() { return this.#_messages.events; }
  private get onMessageValidators() { return this.#_messages.validators; }

  private _serializer: Serializer<ExtractRoomState<T>> = noneSerializer;

  /** Room-level `broadcast`/`broadcastBytes` deferred to ride after the next
   *  patch. Per-client `afterNextPatch` sends go to `client._pendingFrames`, not
   *  here — so this only ever holds the two broadcast variants. */
  private _afterNextPatchQueue: Array<['broadcast' | 'broadcastBytes', ArrayLike<any>]> = [];

  /** Clients that staged `afterNextPatch` frames since the last patch, so the
   *  post-patch flush iterates only these — never the full client list. Shared by
   *  reference onto each client at join, but ONLY in rooms without `defineInput()`:
   *  input rooms drain `_pendingFrames` via the serializer heartbeat, so this stays
   *  empty for them. Reset each `broadcastPatch`. */
  #pendingFrameClients: Array<Client & ClientPrivate> = [];

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
   * Per-client input accessor. Assign it `= this.defineInput(...)`, then call
   * `this.inputs.get(sessionId)` each tick to read that client's buffered input
   * *stream* — iterate it directly, or call `.next()` / `.drain()` / `.latest`.
   *
   * (In the `Room<{ input: I }>` generic, `input` is the input *type* of one
   * frame; `this.inputs` is the per-client accessor over the stream of them.)
   *
   * @example
   * ```typescript
   * class FpsRoom extends Room<{ input: MoveInput }> {
   *   inputs = this.defineInput(MoveInput);
   *
   *   onCreate() {
   *     this.setFixedTimestep((ctx) => {
   *       for (const [sid, p] of this.state.players)
   *         for (const input of this.inputs.get(sid))   // consume one-by-one
   *           applyInput(p, input, ctx.dt);
   *     }, 30);
   *   }
   * }
   * ```
   */
  public inputs?: InputAPI<ExtractRoomInput<T>>;

  /**
   * @internal The per-room input subsystem (options, accessor registry, wire
   * stamp mode, encode/decode/handshake). Created lazily on the first
   * {@link defineInput} call — rooms without inputs allocate none of it, and its
   * presence is what enables client-timed state messages. See {@link RoomInput}.
   */
  private _inputController?: RoomInput;

  /**
   * Declare the input schema and configuration in a single line. Returns the
   * input API that gets assigned to `this.inputs` — call
   * `this.inputs.get(sessionId)` per tick to consume.
   *
   * ```typescript
   * class FpsRoom extends Room<{ input: MoveInput }> {
   *   inputs = this.defineInput(MoveInput, {
   *     seqField: "tick",       // typed: only numeric fields of MoveInput
   *     bufferMaxSize: 64,
   *   });
   *
   *   // …or without options — no seq dedupe, bufferMaxSize: 32:
   *   // inputs = this.defineInput(MoveInput);
   * }
   * ```
   *
   * **Defaults** when `opts` (or individual fields) are omitted:
   * - `seqField`: unset — dedupe and `this.inputs.get(sessionId).at(value)` lookup are
   *   OPT-IN (lockstep / rollback). Name a monotonic numeric field here to enable
   *   them; redundant frames (`input[seqField]` ≤ the last seen) are then dropped.
   *   Leave unset for reliable, in-order channels where every frame is unique.
   * - `bufferMaxSize`: `32` — enables per-client snapshot buffering for
   *   `this.inputs.get(sessionId)` iteration / `.consume() / .drain() / .next() /
   *   .take() / .peek() / .at()`. Set to `0` to disable buffering (the `.latest`
   *   read still works).
   *
   * **Consuming the buffer** — `for (const inp of this.inputs.get(sessionId))` (sugar
   * for `.consume()`) is the per-entity loop: it consumes one at a time, so
   * lag-comp `renderTime` tracks each input. `next()` (take exactly one, ack +1)
   * suits a shared physics world stepped once for everyone; `drain()` returns the
   * whole pending set as an array. See {@link InputAccessor} for the full
   * per-entity-vs-shared-world guidance and why the choice affects the reconcile ack.
   */
  protected defineInput<
    C extends new () => any,
    O extends DefineInputOptions<InstanceType<C>> = DefineInputOptions<InstanceType<C>>,
  >(
    type: C,
    opts?: O,
  ): InputAPI<InstanceType<C>, IdleDeclared<O, InstanceType<C>>> {
    // Lazily spun up on first call; its presence is the "real-time room" gate
    // (enables client-timed state). Rooms that never call this pay nothing.
    this._inputController ??= new RoomInput(this);
    return this._inputController.define<C, O>(type, opts);
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
        return this.clients.get(sessionId)?.reconnectionToken === reconnectionToken;
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
    if (onTickCallback && this._inputController && this._inputController.options.tickRate === undefined) {
      this._inputController.options.tickRate = Math.round(1000 / delay);
    }

    if (onTickCallback) {
      if (this.onUncaughtException !== undefined) {
        onTickCallback = wrapTryCatch(onTickCallback, this.onUncaughtException.bind(this), TimestepException, 'setTimestep');
      }

      this._simulationInterval = setInterval(() => {
        this.clock.tick();
        onTickCallback(this.clock.deltaTime);
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
   * **`tickRate` couples three rates** — by design, one input == one fixed step
   * == one server tick, so lowering `tickRate` to save bandwidth also lowers
   * the simulation rate. To keep high-fidelity physics on a lower network rate,
   * pass `{ subSteps: N }`: one input still drives one fixed step, but you
   * integrate `N` engine sub-steps of `ctx.subDt` (= `ctx.dt / N`) inside it —
   * physics at `tickRate * N` Hz, inputs at `tickRate`/sec. The same
   * `subSteps`/`subDt` are cascaded to predicting clients (via the join
   * handshake, onto their reconciler's step context), so client replay
   * reproduces the sub-stepped trajectory exactly. Render interpolation already
   * smooths above the step rate — most games don't need this; reach for it when
   * the *simulation* needs the extra Hz (fast projectiles, stacking, tunneling).
   *
   * On a hitch the accumulator runs at most a few catch-up steps then drops the
   * backlog (no spiral of death). Lag-comp is recorded once per real frame.
   *
   * **Consuming input inside the step** — how you consume each client's buffer
   * depends on who integrates (see {@link InputAccessor}):
   * - *Per-entity* (each body integrates itself): `for (const cmd of
   *   this.inputs.get(sid)) applyInput(player, cmd, ctx.dt)` — N inputs =
   *   N sub-integrations, ack lands on the newest applied, and `renderTime`
   *   tracks each input (lag comp stays exact per step).
   * - *Shared world* (one solver step advances every body): consume exactly one
   *   input per entity per step with `this.inputs.get(sid).next()` (or `take(n)` +
   *   sub-step), then `world.step()` once. Draining all and applying only the
   *   latest would jump the reconcile ack past inputs you never simulated.
   *
   * @param step - Called once per fixed step with a {@link StepContext}.
   * @param tickRate - Simulation rate in **Hz**. Defaults to 60.
   * @param opts - `subSteps`: physics sub-steps per fixed step (integer ≥ 1,
   *   default 1) — see above.
   *
   * @example
   * ```ts
   * onCreate() {
   *   // 30 inputs/sec on the wire, physics integrated at 60 Hz:
   *   this.setFixedTimestep((ctx) => {
   *     this.applyInputs(ctx);      // consume ONE input per client per step
   *     for (let i = 0; i < ctx.subSteps; i++) this.world.step(ctx.subDt);
   *   }, 30, { subSteps: 2 });
   * }
   * ```
   */
  public setFixedTimestep(step: FixedTimestepCallback, tickRate: number = Math.round(1000 / DEFAULT_SIMULATION_INTERVAL), opts?: { subSteps?: number }): void {
    if (this._simulationInterval) { clearInterval(this._simulationInterval); }

    const stepMs = 1000 / tickRate;
    const stepSeconds = 1 / tickRate;
    // Explicit option wins; else an earlier defineInput({ subSteps }) declaration.
    const subSteps = validateSubSteps(opts?.subSteps, 'setFixedTimestep')
      ?? this._inputController?.options.subSteps ?? 1;

    // Single source of the fixed rate (and sub-step count): advertise both to
    // predicting clients so N and dt can't drift between the two sides.
    if (this._inputController) {
      this._inputController.options.tickRate = tickRate;
      this._inputController.options.subSteps = subSteps;
    }

    let cb = step;
    if (this.onUncaughtException !== undefined) {
      cb = wrapTryCatch(step, this.onUncaughtException.bind(this), TimestepException, 'setFixedTimestep');
    }

    let acc = 0;
    let tick = 0;
    // Reused per-step context — no per-step allocation in the hot loop.
    // subDt = stepSeconds/subSteps: same expression as the client handle's
    // subStepSeconds, so the per-sub-step dt is bit-identical on both sides.
    const ctx = {
      dt: stepSeconds, dtMs: stepMs, tick: 0,
      subSteps, subDt: stepSeconds / subSteps, subDtMs: stepMs / subSteps,
    };
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
        // Dispatch this step's in-frame actions HERE: post-movement, tick-aligned.
        // `hasActions` keeps movement-only rooms from touching the client list.
        if (this._inputController?.hasActions) { this._flushAllInputActions(); }
        ran++;
      }
      if (ran === MAX_CATCHUP_STEPS) { acc = 0; } // hitch: drop backlog, don't spiral
    }, stepMs);
  }

  /** Server-side lag compensation, lazily created. @see allowRewindState */
  #rewind?: Rewind;

  /** @internal The rewind attachments' timeline mode (snapshot/reckon), or
   *  `undefined` when no rewind is configured. {@link RoomInput} reads it to
   *  derive the wire input stamp mode (snapshot → renderTime, reckon → reckonTime). */
  _timelineMode(): { snapshot?: boolean; reckon?: boolean } | undefined {
    return this.#rewind?.timelineMode();
  }

  /** @internal Whether a simulation loop (`setFixedTimestep`/`setSimulationInterval`)
   *  is running. {@link RoomInput} reads it to gate the in-frame-actions wire format:
   *  a consume loop is what dispatches in-frame actions tick-aligned, so a loop-less
   *  (`.latest`-only) room stays on the legacy format and `predict.action` falls back
   *  to the standalone transport. */
  _hasSimulationLoop(): boolean {
    return this._simulationInterval !== undefined;
  }

  /** @internal Dispatch one client's consumed-but-pending in-frame actions to their
   *  `messages` handlers (post-input). Called automatically after each
   *  `setFixedTimestep` step and from `inputs(.get(sid)).dispatchActions()`. */
  _flushInputActions(client: ClientPrivate): void {
    const actions = client._inputBuffer?.takeDispatch();
    if (actions === undefined) { return; }
    for (let i = 0; i < actions.length; i++) {
      this.#_messages.dispatchAction(client as Client & ClientPrivate, actions[i]);
    }
  }

  /** @internal Flush every client's pending in-frame actions (room-wide) — the
   *  `setFixedTimestep` auto-flush and `inputs.dispatchActions()`. */
  _flushAllInputActions(): void {
    const clients = this.clients;
    for (let i = 0; i < clients.length; i++) {
      this._flushInputActions(clients[i] as unknown as ClientPrivate);
    }
  }

  /**
   * Enable server-side lag compensation: returns a {@link Rewind} that records the
   * position history of the entities you attach and automatically snapshots them
   * on each broadcast (the patchRate cadence). Attach the collections to rewind,
   * then read past positions (at a client's renderTime) in your hit tests.
   *
   * @example
   * ```ts
   * const rewind = this.allowRewindState({ maxRewindMs: 500 });
   * rewind.attachAll(this.state.enemies, { fields: ["x", "y"] });
   * // in a hit test — rewind to where the SHOOTER saw the world:
   * const seen = rewind.lastSeenBy(shooterSessionId);   // needs this.defineInput(...)
   * const seenX = seen.value(enemy, "x"), seenY = seen.value(enemy, "y");
   * ```
   *
   * Per-client stamps auto-enable from the `attachAll` `mode` of the groups you
   * rewind — no `renderTime` flag. The default auto-record fires on each
   * broadcast, snapshotting exactly what the client receives — so the rewind
   * reproduces the client's interpolation and hits stay exact even when the
   * broadcast rate differs from the sim rate (`patchRate ≠ timestep`). Call
   * `rewind.record()` yourself during a tick to take over that cadence (you then
   * own correctness against your own broadcast rate).
   */
  public allowRewindState(opts?: RewindOptions): Rewind {
    this.#rewind = Rewind.get(this, opts);
    // Resolve `rewind.lastSeenBy(sid)` through the framework-owned input API.
    // Lazy: read at call time, so field-init order between `inputs` and `rewind`
    // doesn't matter. A missing input API fails loudly; a client that hasn't
    // stamped yet legitimately reads 0 → live fallback (NOT a config error).
    this.#rewind.bindRenderTime((sessionId) => {
      const api = this._inputController?.api;
      if (api === undefined) {
        throw new Error(
          "rewind.lastSeenBy() found no input API. Declare " +
          "`inputs = this.defineInput(YourInput)`, or use " +
          "rewind.at(time) with a render time you track yourself.",
        );
      }
      return api.get(sessionId).renderTime;
    });
    // Direct reckon-display stamp: mode:"reckon" groups read at exactly the
    // instant the client displayed them — immune to its RTT-estimation error.
    this.#rewind.bindReckonTime((sessionId) =>
      this._inputController?.api.get(sessionId).reckonTime ?? 0,
    );
    // Anchor the reckon midpoint FALLBACK at the true processing instant (the
    // record timestamp is one tick stale by hit-test time — see bindNow).
    this.#rewind.bindNow(() => this.clock.elapsedTime);
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
    // encode time inside `applyPatches`. Per-client `afterNextPatch` frames
    // (in-frame verdicts + sends) live on `client._pendingFrames` and ride
    // INTO each client's patch frame here (brief 21, Design B).
    const sNow = this.clock.elapsedTime;
    const hasChanges = this._serializer.applyPatches(
      this.clients,
      this.state,
      this._inputController !== undefined ? { sNow } : undefined,
    );

    // The serializer drains `_pendingFrames` for every client it sends a patch to.
    // The only gap: a room WITHOUT `defineInput()` on a no-change tick sends no
    // patch (no heartbeat), so flush any still-staged frames standalone — never
    // stranded. Iterates only `#pendingFrameClients` (empty for input rooms → O(1)).
    this._flushPendingClientFrames();

    // Lag-comp: record the snapshot the client just received, on the broadcast
    // cadence and stamped with the SAME `sNow` the frame carries — so valueAt()
    // reproduces the client's interpolation over the IDENTICAL pair (exact hits
    // at any patchRate). Idempotent per `sNow`: a manual record() this tick wins,
    // and a patchRate faster than the sim simply dedups back to per-tick.
    const rw = this.#rewind;
    if (rw !== undefined && rw.lastRecordedAt !== sNow) {
      rw.record(sNow, this.#_patchRate || undefined);
    }

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
    callback: (client: C, message: T, ctx: MessageContext) => unknown,
  );
  public onMessage<T = any, C extends Client = ExtractRoomClient<T>>(
    messageType: string | number,
    validationSchema: StandardSchemaV1<T>,
    callback: (client: C, message: T, ctx: MessageContext) => unknown,
  );
  public onMessage<T = any>(
    _messageType: '*' | string | number,
    _validationSchema: StandardSchemaV1<T> | ((...args: any[]) => void),
    _callback?: (...args: any[]) => void,
  ) {
    return this.#_messages.on(_messageType, _validationSchema as any, _callback);
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
    return this.#_messages.on(`_$b${_messageType}`, _validationSchema as any, _callback);
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

    // Allocate per-client input state early so onJoin can read inputs.get(sid).latest.
    this._inputController?.allocate(client);

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
      this.clients.get(sessionId)?.reconnectionToken === connectionOptions.reconnectionToken
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

    // Non-input rooms: share the after-patch flush list so a client can announce
    // staged frames without the flush scanning every client. Input rooms drain via
    // the serializer heartbeat — they don't track (and `_inputController` is set in
    // `defineInput`, before any client joins).
    if (this._inputController === undefined) {
      (client as Client & ClientPrivate)._pendingFrameClients = this.#pendingFrameClients;
    }

    // add temporary callback to keep track of disconnections during `onJoin`.
    client.ref['onleave'] = (_) => client.state = ClientState.LEAVING;
    client.ref.once('close', client.ref['onleave']);

    if (isWaitingReconnection) {
      const reconnectionToken = connectionOptions?.reconnectionToken;
      if (reconnectionToken && this._reconnections[reconnectionToken]?.[0] === sessionId) {
        this.clients.push(client);
        // After push (no leak on a failed join), before onReconnect; overwrites
        // the dropped session's stale entry.
        this._inputController?.register(sessionId, client);

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
        // After push (no leak on a failed join), before onJoin (resolves inputs.get there).
        this._inputController?.register(sessionId, client);

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

      // NOT gated by skipHandshake: that flag means "client already has the STATE
      // schema", but these carry input config the client can't derive locally
      // (re-parsing on reconnect is idempotent).
      const extraSections = this._inputController?.handshakeSections();

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

  private sendFullState(client: Client): void {
    client.raw(this._serializer.getFullState(
      client,
      this._inputController !== undefined ? { sNow: this.clock.elapsedTime } : undefined,
    ));
  }

  /** Send any `afterNextPatch` frames the serializer didn't carry this tick (a
   *  no-change tick in a room without `defineInput()`) as standalone frames, so a
   *  message is never stranded — then reset the tracker. Iterates only the clients
   *  that staged frames this cycle (`#pendingFrameClients`), never the full client
   *  list; empty (→ O(1)) for input rooms and idle non-input rooms. A client whose
   *  frames a patch already carried is skipped (its buffer is empty). */
  private _flushPendingClientFrames() {
    const dirty = this.#pendingFrameClients;
    if (dirty.length === 0) { return; }
    for (let i = 0; i < dirty.length; i++) {
      const frames = dirty[i]._pendingFrames;
      if (frames !== undefined && frames.length > 0) {
        for (let j = 0; j < frames.length; j++) { dirty[i].raw(frames[j]); }
        frames.length = 0;
      }
    }
    dirty.length = 0;
  }

  /** Flush room-level `afterNextPatch` broadcasts after the patch. Per-client
   *  `afterNextPatch` sends ride the patch frame via `_pendingFrames` and never
   *  reach this queue, so only the two broadcast variants are dispatched here. */
  private _dequeueAfterPatchMessages() {
    const length = this._afterNextPatchQueue.length;

    if (length > 0) {
      for (let i = 0; i < length; i++) {
        const [target, args] = this._afterNextPatchQueue[i];

        if (target === "broadcastBytes") {
          this.broadcastBytes.apply(this, args as any);
        } else {
          this.broadcast.apply(this, args as any);
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
        // devMode reconnection bypasses #_onAfterLeave — drop the input accessor here.
        this._inputController?.release(sessionId);

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
      clearTimeout(this._autoDisposeTimeout);
      this._autoDisposeTimeout = undefined;
    }

    // clear all timeouts/intervals + force to stop ticking
    this.clock.clear();
    this.clock.stop();

    // drop any input accessors still held for in-flight reconnections
    this._inputController?.dispose();

    return await (userReturnData || Promise.resolve());
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
      this.#_messages.onData(client, buffer, it);

    } else if (code === Protocol.ROOM_REQUEST) {
      this.#_messages.onRequest(client, buffer, it);

    } else if (code === Protocol.ROOM_DATA_BYTES) {
      this.#_messages.onDataBytes(client, buffer, it);

    } else if (code === Protocol.ROOM_INPUT_RELIABLE) {
      this._inputController?.decodeReliable(client, buffer, it, modifiers);

    } else if (code === Protocol.ROOM_INPUT_UNRELIABLE) {
      this._inputController?.decodeUnreliable(client, buffer, modifiers);

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

    // Freeze the seat: a held (reconnecting) session idles from the first tick
    // instead of replaying last-known moves.
    this._inputController?.freeze(client as unknown as ClientPrivate);

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
      // Session fully gone — drop its accessor. No identity check needed: a
      // successful reconnect skips this finalizer, so the entry is always this client's.
      this._inputController?.release(client.sessionId);
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