import { unpack } from '@colyseus/msgpackr';
import { decode, type Iterator, $changes } from '@colyseus/schema';

import Clock from '@colyseus/timer';
import { EventEmitter } from 'events';
import { logger } from './Logger.js';

import { Presence } from './presence/Presence.js';

import { NoneSerializer } from './serializer/NoneSerializer.js';
import { SchemaSerializer } from './serializer/SchemaSerializer.js';
import { Serializer } from './serializer/Serializer.js';

import { ErrorCode, getMessageBytes, Protocol } from './Protocol.js';
import { Deferred, generateId, wrapTryCatch } from './utils/Utils.js';
import { isDevMode } from './utils/DevMode.js';

import { debugAndPrintError, debugMatchMaking, debugMessage } from './Debug.js';
import { RoomCache } from './matchmaker/driver/api.js';
import { ServerError } from './errors/ServerError.js';
import { AuthContext, Client, ClientPrivate, ClientArray, ClientState, ISendOptions } from './Transport.js';
import { OnAuthException, OnCreateException, OnDisposeException, OnJoinException, OnLeaveException, OnMessageException, RoomException, SimulationIntervalException, TimedEventException } from './errors/RoomExceptions.js';

const DEFAULT_PATCH_RATE = 1000 / 20; // 20fps (50ms)
const DEFAULT_SIMULATION_INTERVAL = 1000 / 60; // 60fps (16.66ms)
const noneSerializer = new NoneSerializer();

export const DEFAULT_SEAT_RESERVATION_TIME = Number(process.env.COLYSEUS_SEAT_RESERVATION_TIME || 15);

export type SimulationCallback = (deltaTime: number) => void;

export interface IBroadcastOptions extends ISendOptions {
  except?: Client | Client[];
}

export enum RoomInternalState {
  CREATING = 0,
  CREATED = 1,
  DISPOSING = 2,
}

export type ExtractUserData<T> = T extends ClientArray<infer U> ? U : never;
export type ExtractAuthData<T> = T extends ClientArray<infer _, infer U> ? U : never;

/**
 * A Room class is meant to implement a game session, and/or serve as the communication channel
 * between a group of clients.
 *
 * - Rooms are created on demand during matchmaking by default
 * - Room classes must be exposed using `.define()`
 */
export abstract class Room<State extends object= any, Metadata= any, UserData = any, AuthData = any> {

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

  public get metadata() {
    return this.listing.metadata;
  }

  public listing: RoomCache<Metadata>;

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
  public patchRate: number = DEFAULT_PATCH_RATE;
  #_patchRate: number;
  #_patchInterval: NodeJS.Timeout;

  /**
   * The state instance you provided to `setState()`.
   */
  public state: State;
  #_state: State;

  /**
   * The presence instance. Check Presence API for more details.
   *
   * @see {@link https://docs.colyseus.io/colyseus/server/presence/|Presence API}
   */
  public presence: Presence;

  /**
   * The array of connected clients.
   *
   * @see {@link https://docs.colyseus.io/colyseus/server/room/#client|Client instance}
   */
  public clients: ClientArray<UserData, AuthData> = new ClientArray();

  /** @internal */
  public _events = new EventEmitter();

  // seat reservation & reconnection
  protected seatReservationTime: number = DEFAULT_SEAT_RESERVATION_TIME;
  protected reservedSeats: { [sessionId: string]: [any, any, boolean?, boolean?] } = {};
  protected reservedSeatTimeouts: { [sessionId: string]: NodeJS.Timeout } = {};

  protected _reconnections: { [reconnectionToken: string]: [string, Deferred] } = {};
  private _reconnectingSessionId = new Map<string, string>();

  private onMessageHandlers: {
    [id: string]: {
      callback: (...args: any[]) => void,
      validate?: (data: unknown) => any,
    }
  } = {
      '__no_message_handler': {
        callback: (client: Client, messageType: string, _: unknown) => {
          const errorMessage = `room onMessage for "${messageType}" not registered.`;
          debugAndPrintError(`${errorMessage} (roomId: ${this.roomId})`);

          if (isDevMode) {
            // send error code to client in development mode
            client.error(ErrorCode.INVALID_PAYLOAD, errorMessage);

          } else {
            // immediately close the connection in production
            client.leave(Protocol.WS_CLOSE_WITH_ERROR, errorMessage);
          }
        }
      }
    };

  private _serializer: Serializer<State> = noneSerializer;
  private _afterNextPatchQueue: Array<[string | Client, IArguments]> = [];

  private _simulationInterval: NodeJS.Timeout;

  private _internalState: RoomInternalState = RoomInternalState.CREATING;

  private _lockedExplicitly: boolean = false;
  #_locked: boolean = false;

  // this timeout prevents rooms that are created by one process, but no client
  // ever had success joining into it on the specified interval.
  private _autoDisposeTimeout: NodeJS.Timeout;

  constructor() {
    this._events.once('dispose', () => {
      this._dispose()
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
  protected __init() {
    this.#_state = this.state;
    this.#_autoDispose = this.autoDispose;
    this.#_patchRate = this.patchRate;
    this.#_maxClients = this.maxClients;

    Object.defineProperties(this, {
      state: {
        enumerable: true,
        get: () => this.#_state,
        set: (newState: State) => {
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
          this.#_maxClients = value;

          if (this._internalState === RoomInternalState.CREATED) {
            const hasReachedMaxClients = this.hasReachedMaxClients();

            // unlock room if maxClients has been increased
            if (!this._lockedExplicitly && this.#_maxClientsReached && !hasReachedMaxClients) {
              this.#_maxClientsReached = false;
              this.#_locked = false;
              this.listing.locked = false;
            }

            // lock room if maxClients has been decreased
            if (hasReachedMaxClients) {
              this.#_maxClientsReached = true;
              this.#_locked = true;
              this.listing.locked = true;
            }

            this.listing.maxClients = value;
            this.listing.save();
          }
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

    // set default _autoDisposeTimeout
    this.resetAutoDisposeTimeout(this.seatReservationTime);

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
  public onBeforePatch?(state: State): void | Promise<any>;
  public onCreate?(options: any): void | Promise<any>;
  public onJoin?(client: Client<UserData, AuthData>, options?: any, auth?: AuthData): void | Promise<any>;
  public onLeave?(client: Client<UserData, AuthData>, consented?: boolean): void | Promise<any>;
  public onDispose?(): void | Promise<any>;

  /**
   * Define a custom exception handler.
   * If defined, all lifecycle hooks will be wrapped by try/catch, and the exception will be forwarded to this method.
   *
   * These methods will be wrapped by try/catch:
   * - `onMessage`
   * - `onAuth` / `onJoin` / `onLeave` / `onCreate` / `onDispose`
   * - `clock.setTimeout` / `clock.setInterval`
   * - `setSimulationInterval`
   *
   * (Experimental: this feature is subject to change in the future - we're currently getting feedback to improve it)
   */
  public onUncaughtException?(error: RoomException<this>, methodName: 'onCreate' | 'onAuth' | 'onJoin' | 'onLeave' | 'onDispose' | 'onMessage' | 'setSimulationInterval' | 'setInterval' | 'setTimeout'): void;

  public onAuth(
    client: Client<UserData, AuthData>,
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
        ? Protocol.WS_CLOSE_DEVMODE_RESTART
        : Protocol.WS_CLOSE_CONSENTED
    );
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
      (this.clients.length + Object.keys(this.reservedSeats).length) >= this.maxClients ||
      this._internalState === RoomInternalState.DISPOSING
    );
  }

  /**
   * Set the number of seconds a room can wait for a client to effectively join the room.
   * You should consider how long your `onAuth()` will have to wait for setting a different seat reservation time.
   * The default value is 15 seconds. You may set the `COLYSEUS_SEAT_RESERVATION_TIME`
   * environment variable if you'd like to change the seat reservation time globally.
   *
   * @default 15 seconds
   *
   * @param seconds - number of seconds.
   * @returns The modified Room object.
   */
  public setSeatReservationTime(seconds: number) {
    this.seatReservationTime = seconds;
    return this;
  }

  public hasReservedSeat(sessionId: string, reconnectionToken?: string): boolean {
    const reservedSeat = this.reservedSeats[sessionId];

    // seat reservation not found / expired
    if (reservedSeat === undefined) {
      return false;
    }

    if (reservedSeat[3]) {
      // reconnection
      return (
        reconnectionToken &&
        this._reconnections[reconnectionToken]?.[0] === sessionId &&
        this._reconnectingSessionId.has(sessionId)
      );

    } else {
      // seat reservation not consumed
      return reservedSeat[2] === false;
    }
  }

  public checkReconnectionToken(reconnectionToken: string) {
    const sessionId = this._reconnections[reconnectionToken]?.[0];
    const reservedSeat = this.reservedSeats[sessionId];

    if (reservedSeat && reservedSeat[3]) {
      this._reconnectingSessionId.set(sessionId, reconnectionToken);
      return sessionId;

    } else {
      return undefined;
    }
  }

  /**
   * (Optional) Set a simulation interval that can change the state of the game.
   * The simulation interval is your game loop.
   *
   * @default 16.6ms (60fps)
   *
   * @param onTickCallback - You can implement your physics or world updates here!
   *  This is a good place to update the room state.
   * @param delay - Interval delay on executing `onTickCallback` in milliseconds.
   */
  public setSimulationInterval(onTickCallback?: SimulationCallback, delay: number = DEFAULT_SIMULATION_INTERVAL): void {
    // clear previous interval in case called setSimulationInterval more than once
    if (this._simulationInterval) { clearInterval(this._simulationInterval); }

    if (onTickCallback) {
      if (this.onUncaughtException !== undefined) {
        onTickCallback = wrapTryCatch(onTickCallback, this.onUncaughtException.bind(this), SimulationIntervalException, 'setSimulationInterval');
      }

      this._simulationInterval = setInterval(() => {
        this.clock.tick();
        onTickCallback(this.clock.deltaTime);
      }, delay);
    }
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
  public setState(newState: State) {
    this.state = newState;
  }

  public setSerializer(serializer: Serializer<State>) {
    this._serializer = serializer;
  }

  public async setMetadata(meta: Partial<Metadata>) {
    if (!this.listing.metadata) {
      this.listing.metadata = meta as Metadata;

    } else {
      for (const field in meta) {
        if (!meta.hasOwnProperty(field)) { continue; }
        this.listing.metadata[field] = meta[field];
      }

      // `MongooseDriver` workaround: persit metadata mutations
      if ('markModified' in this.listing) {
        (this.listing as any).markModified('metadata');
      }
    }

    if (this._internalState === RoomInternalState.CREATED) {
      await this.listing.save();
    }
  }

  public async setPrivate(bool: boolean = true) {
    if (this.listing.private === bool) return;

    this.listing.private = bool;

    if (this._internalState === RoomInternalState.CREATED) {
      await this.listing.save();
    }

    this._events.emit('visibility-change', bool);
  }

  /**
   * Locking the room will remove it from the pool of available rooms for new clients to connect to.
   */
  public async lock() {
    // rooms locked internally aren't explicit locks.
    this._lockedExplicitly = (arguments[0] === undefined);

    // skip if already locked.
    if (this.#_locked) { return; }

    this.#_locked = true;

    await this.listing.updateOne({
      $set: { locked: this.#_locked },
    });

    this._events.emit('lock');
  }

  /**
   * Unlocking the room returns it to the pool of available rooms for new clients to connect to.
   */
  public async unlock() {
    // only internal usage passes arguments to this function.
    if (arguments[0] === undefined) {
      this._lockedExplicitly = false;
    }

    // skip if already locked
    if (!this.#_locked) { return; }

    this.#_locked = false;

    await this.listing.updateOne({
      $set: { locked: this.#_locked },
    });

    this._events.emit('unlock');
  }

  public send(client: Client, type: string | number, message: any, options?: ISendOptions): void;
  public send(client: Client, messageOrType: any, messageOrOptions?: any | ISendOptions, options?: ISendOptions): void {
    logger.warn('DEPRECATION WARNING: use client.send(...) instead of this.send(client, ...)');
    client.send(messageOrType, messageOrOptions, options);
  }

  public broadcast(type: string | number, message?: any, options?: IBroadcastOptions) {
    if (options && options.afterNextPatch) {
      delete options.afterNextPatch;
      this._afterNextPatchQueue.push(['broadcast', arguments]);
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

    const hasChanges = this._serializer.applyPatches(this.clients, this.state);

    // broadcast messages enqueued for "after patch"
    this._dequeueAfterPatchMessages();

    return hasChanges;
  }

  public onMessage<T = any>(
    messageType: '*',
    callback: (client: Client<UserData, AuthData>, type: string | number, message: T) => void
  );
  public onMessage<T = any>(
    messageType: string | number,
    callback: (client: Client<UserData, AuthData>, message: T) => void,
    validate?: (message: unknown) => T,
  );
  public onMessage<T = any>(
    messageType: '*' | string | number,
    callback: (...args: any[]) => void,
    validate?: (message: unknown) => T,
  ) {
    this.onMessageHandlers[messageType] = (this.onUncaughtException !== undefined)
      ? { validate, callback: wrapTryCatch(callback, this.onUncaughtException.bind(this), OnMessageException, 'onMessage', false, messageType) }
      : { validate, callback };


    // returns a method to unbind the callback
    return () => delete this.onMessageHandlers[messageType];
  }

  /**
   * Disconnect all connected clients, and then dispose the room.
   *
   * @param closeCode WebSocket close code (default = 4000, which is a "consented leave")
   * @returns Promise<void>
   */
  public disconnect(closeCode: number = Protocol.WS_CLOSE_CONSENTED): Promise<any> {
    // skip if already disposing
    if (this._internalState === RoomInternalState.DISPOSING) {
      return Promise.resolve(`disconnect() ignored: room (${this.roomId}) is already disposing.`);

    } else if (this._internalState === RoomInternalState.CREATING) {
      throw new Error("cannot disconnect during onCreate()");
    }

    this._internalState = RoomInternalState.DISPOSING;
    this.listing.remove();

    this.#_autoDispose = true;

    const delayedDisconnection = new Promise<void>((resolve) =>
      this._events.once('disconnect', () => resolve()));

    // reject pending reconnections
    for (const [_, reconnection] of Object.values(this._reconnections)) {
      reconnection.reject(new Error("disconnecting"));
    }

    let numClients = this.clients.length;
    if (numClients > 0) {
      // clients may have `async onLeave`, room will be disposed after they're fulfilled
      while (numClients--) {
        this._forciblyCloseClient(this.clients[numClients] as Client & ClientPrivate, closeCode);
      }

    } else {
      // no clients connected, dispose immediately.
      this._events.emit('dispose');
    }

    return delayedDisconnection;
  }

  public async ['_onJoin'](client: Client & ClientPrivate, authContext: AuthContext) {
    const sessionId = client.sessionId;

    // generate unique private reconnection token
    client.reconnectionToken = generateId();

    if (this.reservedSeatTimeouts[sessionId]) {
      clearTimeout(this.reservedSeatTimeouts[sessionId]);
      delete this.reservedSeatTimeouts[sessionId];
    }

    // clear auto-dispose timeout.
    if (this._autoDisposeTimeout) {
      clearTimeout(this._autoDisposeTimeout);
      this._autoDisposeTimeout = undefined;
    }

    // get seat reservation options and clear it
    const [joinOptions, authData, isConsumed, isWaitingReconnection] = this.reservedSeats[sessionId];

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
    this.reservedSeats[sessionId][2] = true; // flag seat reservation as "consumed"
    debugMatchMaking('consuming seat reservation, sessionId: \'%s\' (roomId: %s)', client.sessionId, this.roomId);

    // share "after next patch queue" reference with every client.
    client._afterNextPatchQueue = this._afterNextPatchQueue;

    // add temporary callback to keep track of disconnections during `onJoin`.
    client.ref['onleave'] = (_) => client.state = ClientState.LEAVING;
    client.ref.once('close', client.ref['onleave']);

    if (isWaitingReconnection) {
      const previousReconnectionToken = this._reconnectingSessionId.get(sessionId);
      if (previousReconnectionToken) {
        this.clients.push(client);
        //
        // await for reconnection:
        // (end user may customize the reconnection token at this step)
        //
        await this._reconnections[previousReconnectionToken]?.[1].resolve(client);

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
            delete this.reservedSeats[sessionId];
            await this._decrementClientCount();
            throw e;
          }
        }

        //
        // On async onAuth, client may have been disconnected.
        //
        if (client.state === ClientState.LEAVING) {
          throw new ServerError(Protocol.WS_CLOSE_GOING_AWAY, 'already disconnected');
        }

        this.clients.push(client);

        //
        // Flag sessionId as non-enumarable so hasReachedMaxClients() doesn't count it
        // (https://github.com/colyseus/colyseus/issues/726)
        //
        Object.defineProperty(this.reservedSeats, sessionId, {
          value: this.reservedSeats[sessionId],
          enumerable: false,
        });

        if (this.onJoin) {
          await this.onJoin(client, joinOptions, client.auth);
        }

        // @ts-ignore: client left during `onJoin`, call _onLeave immediately.
        if (client.state === ClientState.LEAVING) {
          throw new Error("early_leave");

        } else {
          // remove seat reservation
          delete this.reservedSeats[sessionId];

          // emit 'join' to room handler
          this._events.emit('join', client);
        }

      } catch (e) {
        await this._onLeave(client, Protocol.WS_CLOSE_GOING_AWAY);

        // remove seat reservation
        delete this.reservedSeats[sessionId];

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

      // confirm room id that matches the room name requested to join
      client.raw(getMessageBytes[Protocol.JOIN_ROOM](
        client.reconnectionToken,
        this._serializer.id,
        this._serializer.handshake && this._serializer.handshake(),
      ));
    }
  }

  /**
   * Allow the specified client to reconnect into the room. Must be used inside `onLeave()` method.
   * If seconds is provided, the reconnection is going to be cancelled after the provided amount of seconds.
   *
   * @param previousClient - The client which is to be waiting until re-connection happens.
   * @param seconds - Timeout period on re-connection in seconds.
   *
   * @returns Deferred<Client> - The differed is a promise like type.
   *  This type can forcibly reject the promise by calling `.reject()`.
   */
  public allowReconnection(previousClient: Client, seconds: number | "manual"): Deferred<Client> {
    //
    // Return rejected promise if client has never fully JOINED.
    //
    // (having `_enqueuedMessages !== undefined` means that the client has never been at "ClientState.JOINED" state)
    //
    if ((previousClient as unknown as ClientPrivate)._enqueuedMessages !== undefined) {
      // @ts-ignore
      return Promise.reject(new Error("not joined"));
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

    this._reserveSeat(sessionId, true, previousClient.auth, seconds, true);

    // keep reconnection reference in case the user reconnects into this room.
    const reconnection = new Deferred<Client & ClientPrivate>();
    this._reconnections[reconnectionToken] = [sessionId, reconnection];

    if (seconds !== Infinity) {
      // expire seat reservation after timeout
      this.reservedSeatTimeouts[sessionId] = setTimeout(() =>
        reconnection.reject(false), seconds * 1000);
    }

    const cleanup = () => {
      delete this._reconnections[reconnectionToken];
      delete this.reservedSeats[sessionId];
      delete this.reservedSeatTimeouts[sessionId];
      this._reconnectingSessionId.delete(sessionId);
    };

    reconnection.
      then((newClient) => {
        newClient.auth = previousClient.auth;
        newClient.userData = previousClient.userData;
        newClient.view = previousClient.view;

        // for convenience: populate previous client reference with new client
        previousClient.state = ClientState.RECONNECTED;
        previousClient.ref = newClient.ref;
        previousClient.reconnectionToken = newClient.reconnectionToken;
        clearTimeout(this.reservedSeatTimeouts[sessionId]);
        cleanup();
      }).
      catch(() => {
        cleanup();
        this.resetAutoDisposeTimeout();
      });

    return reconnection;
  }

  protected resetAutoDisposeTimeout(timeoutInSeconds: number = 1) {
    clearTimeout(this._autoDisposeTimeout);

    if (!this.#_autoDispose) {
      return;
    }

    this._autoDisposeTimeout = setTimeout(() => {
      this._autoDisposeTimeout = undefined;
      this._disposeIfEmpty();
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

  protected sendFullState(client: Client): void {
    client.raw(this._serializer.getFullState(client));
  }

  protected _dequeueAfterPatchMessages() {
    const length = this._afterNextPatchQueue.length;

    if (length > 0) {
      for (let i = 0; i < length; i++) {
        const [target, args] = this._afterNextPatchQueue[i];

        if (target === "broadcast") {
          this.broadcast.apply(this, args);

        } else {
          (target as Client).raw.apply(target, args);
        }
      }

      // new messages may have been added in the meantime,
      // let's splice the ones that have been processed
      this._afterNextPatchQueue.splice(0, length);
    }
  }

  protected async _reserveSeat(
    sessionId: string,
    joinOptions: any = true,
    authData: any = undefined,
    seconds: number = this.seatReservationTime,
    allowReconnection: boolean = false,
    devModeReconnection?: boolean,
  ) {
    if (!allowReconnection && this.hasReachedMaxClients()) {
      return false;
    }

    this.reservedSeats[sessionId] = [joinOptions, authData, false, allowReconnection];

    if (!allowReconnection) {
      await this._incrementClientCount();

      this.reservedSeatTimeouts[sessionId] = setTimeout(async () => {
        delete this.reservedSeats[sessionId];
        delete this.reservedSeatTimeouts[sessionId];
        await this._decrementClientCount();
      }, seconds * 1000);

      this.resetAutoDisposeTimeout(seconds);
    }

    //
    // isDevMode workaround to allow players to reconnect on devMode
    //
    if (devModeReconnection) {
      this._reconnectingSessionId.set(sessionId, sessionId);
    }

    return true;
  }

  protected _disposeIfEmpty() {
    const willDispose = (
      this.#_onLeaveConcurrent === 0 && // no "onLeave" calls in progress
      this.#_autoDispose &&
      this._autoDisposeTimeout === undefined &&
      this.clients.length === 0 &&
      Object.keys(this.reservedSeats).length === 0
    );

    if (willDispose) {
      this._events.emit('dispose');
    }

    return willDispose;
  }

  protected async _dispose(): Promise<any> {
    this._internalState = RoomInternalState.DISPOSING;

    this.listing.remove();

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

  protected _onMessage(client: Client & ClientPrivate, buffer: Buffer) {
    // skip if client is on LEAVING state.
    if (client.state === ClientState.LEAVING) { return; }

    const it: Iterator = { offset: 1 };
    const code = buffer[0];

    if (!buffer) {
      debugAndPrintError(`${this.roomName} (roomId: ${this.roomId}), couldn't decode message: ${buffer}`);
      return;
    }

    if (code === Protocol.ROOM_DATA) {
      const messageType = (decode.stringCheck(buffer, it))
        ? decode.string(buffer, it)
        : decode.number(buffer, it);
      const messageTypeHandler = this.onMessageHandlers[messageType];

      let message;
      try {
        message = (buffer.byteLength > it.offset)
          ? unpack(buffer.subarray(it.offset, buffer.byteLength))
          : undefined;
        debugMessage("received: '%s' -> %j (roomId: %s)", messageType, message, this.roomId);

        // custom message validation
        if (messageTypeHandler?.validate !== undefined) {
          message = messageTypeHandler.validate(message);
        }

      } catch (e) {
        debugAndPrintError(e);
        client.leave(Protocol.WS_CLOSE_WITH_ERROR);
        return;
      }

      if (messageTypeHandler) {
        messageTypeHandler.callback(client, message);

      } else {
        (this.onMessageHandlers['*'] || this.onMessageHandlers['__no_message_handler']).callback(client, messageType, message);
      }

    } else if (code === Protocol.ROOM_DATA_BYTES) {
      const messageType = (decode.stringCheck(buffer, it))
        ? decode.string(buffer, it)
        : decode.number(buffer, it);
      const messageTypeHandler = this.onMessageHandlers[messageType];

      let message = buffer.subarray(it.offset, buffer.byteLength);
      debugMessage("received: '%s' -> %j (roomId: %s)", messageType, message, this.roomId);

      // custom message validation
      if (messageTypeHandler?.validate !== undefined) {
        message = messageTypeHandler.validate(message);
      }

      if (messageTypeHandler) {
        messageTypeHandler.callback(client, message);

      } else {
        (this.onMessageHandlers['*'] || this.onMessageHandlers['__no_message_handler']).callback(client, messageType, message);
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

    } else if (code === Protocol.LEAVE_ROOM) {
      this._forciblyCloseClient(client, Protocol.WS_CLOSE_CONSENTED);
    }

  }

  protected _forciblyCloseClient(client: Client & ClientPrivate, closeCode: number) {
    // stop receiving messages from this client
    client.ref.removeAllListeners('message');

    // prevent "onLeave" from being called twice if player asks to leave
    client.ref.removeListener('close', client.ref['onleave']);

    // only effectively close connection when "onLeave" is fulfilled
    this._onLeave(client, closeCode).then(() => client.leave(closeCode));
  }

  protected async _onLeave(client: Client, code?: number): Promise<any> {
    debugMatchMaking('onLeave, sessionId: \'%s\' (close code: %d, roomId: %s)', client.sessionId, code, this.roomId);

    // call 'onLeave' method only if the client has been successfully accepted.
    client.state = ClientState.LEAVING;

    if (!this.clients.delete(client)) {
      // skip if client already left the room
      return;
    }

    if (this.onLeave) {
      try {
        this.#_onLeaveConcurrent++;
        await this.onLeave(client, (code === Protocol.WS_CLOSE_CONSENTED));

      } catch (e) {
        debugAndPrintError(`onLeave error: ${(e && e.message || e || 'promise rejected')} (roomId: ${this.roomId})`);

      } finally {
        this.#_onLeaveConcurrent--;
      }
    }

    // check for manual "reconnection" flow
    if (this._reconnections[client.reconnectionToken]) {
      this._reconnections[client.reconnectionToken][1].catch(async () => {
        await this._onAfterLeave(client);
      });

      // @ts-ignore (client.state may be modified at onLeave())
    } else if (client.state !== ClientState.RECONNECTED) {
      await this._onAfterLeave(client);
    }
  }

  protected async _onAfterLeave(client: Client) {
    // try to dispose immediately if client reconnection isn't set up.
    const willDispose = await this._decrementClientCount();

    // trigger 'leave' only if seat reservation has been fully consumed
    if (this.reservedSeats[client.sessionId] === undefined) {
      this._events.emit('leave', client, willDispose);
    }

  }

  protected async _incrementClientCount() {
    // lock automatically when maxClients is reached
    if (!this.#_locked && this.hasReachedMaxClients()) {
      this.#_maxClientsReached = true;
      this.lock.call(this, true);
    }

    await this.listing.updateOne({
      $inc: { clients: 1 },
      $set: { locked: this.#_locked },
    });
  }

  protected async _decrementClientCount() {
    const willDispose = this._disposeIfEmpty();

    if (this._internalState === RoomInternalState.DISPOSING) {
      return true;
    }

    // unlock if room is available for new connections
    if (!willDispose) {
      if (this.#_maxClientsReached && !this._lockedExplicitly) {
        this.#_maxClientsReached = false;
        this.unlock.call(this, true);
      }

      // update room listing cache
      await this.listing.updateOne({
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

    if (this.onDispose !== undefined) {
      this.onDispose = wrapTryCatch(this.onDispose.bind(this), onUncaughtException, OnDisposeException, 'onDispose');
    }
  }

}
