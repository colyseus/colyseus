import msgpack from 'notepack.io';

import Clock from '@gamestdio/timer';
import { EventEmitter } from 'events';

import { Client } from '.';
import { Presence } from './presence/Presence';

import { SchemaSerializer } from './serializer/SchemaSerializer';
import { Serializer } from './serializer/Serializer';

import { decode, Protocol, send, WS_CLOSE_CONSENTED } from './Protocol';
import { Deferred, spliceOne } from './Utils';

import { debugAndPrintError, debugPatch } from './Debug';

const DEFAULT_PATCH_RATE = 1000 / 20; // 20fps (50ms)
const DEFAULT_SIMULATION_INTERVAL = 1000 / 60; // 60fps (16.66ms)

const DEFAULT_SEAT_RESERVATION_TIME = Number(process.env.COLYSEUS_SEAT_RESERVATION_TIME || 5);

export type SimulationCallback = (deltaTime: number) => void;

export type RoomConstructor<T= any> = new (presence?: Presence) => Room<T>;

export interface RoomAvailable {
  roomId: string;
  clients: number;
  maxClients: number;
  metadata?: any;
}

export interface BroadcastOptions {
  except?: Client;
  afterNextPatch?: boolean;
}

export abstract class Room<T= any> extends EventEmitter {
  public clock: Clock = new Clock();

  public roomId: string;
  public roomName: string;

  public maxClients: number = Infinity;
  public patchRate: number = DEFAULT_PATCH_RATE;
  public autoDispose: boolean = true;

  public state: T;
  public metadata: any = null;
  public presence: Presence;

  public clients: Client[] = [];

  // seat reservation & reconnection
  protected seatReservationTime: number = DEFAULT_SEAT_RESERVATION_TIME;
  protected reservedSeats: Set<string> = new Set();
  protected reservedSeatTimeouts: {[sessionId: string]: NodeJS.Timer} = {};

  protected reconnections: {[sessionId: string]: Deferred} = {};
  protected isDisconnecting: boolean = false;

  private _serializer: Serializer<T> = this._getSerializer();
  private _afterNextPatchBroadcasts: Array<[any, BroadcastOptions]> = [];

  private _simulationInterval: NodeJS.Timer;
  private _patchInterval: NodeJS.Timer;

  private _locked: boolean = false;
  private _lockedExplicitly: boolean = false;
  private _maxClientsReached: boolean = false;

  // this timeout prevents rooms that are created by one process, but no client
  // ever had success joining into it on the specified interval.
  private _autoDisposeTimeout: NodeJS.Timer;

  constructor(presence?: Presence) {
    super();

    this.presence = presence;

    this.once('dispose', async () => {
      try {
        await this._dispose();

      } catch (e) {
        debugAndPrintError(`onDispose error: ${(e && e.message || e || 'promise rejected')}`);
      }
      this.emit('disconnect');
    });

    this.setPatchRate(this.patchRate);
  }

  // Abstract methods
  public abstract onMessage(client: Client, data: any): void;

  // Optional abstract methods
  public onInit?(options: any): void;
  public onJoin?(client: Client, options?: any, auth?: any): void | Promise<any>;
  public onLeave?(client: Client, consented?: boolean): void | Promise<any>;
  public onDispose?(): void | Promise<any>;

  public requestJoin(options: any, isNew?: boolean): number | boolean {
    return 1;
  }

  public onAuth(options: any): boolean | Promise<any> {
    return true;
  }

  public get locked() {
    return this._locked;
  }

  public hasReachedMaxClients(): boolean {
    return (this.clients.length + this.reservedSeats.size) >= this.maxClients;
  }

  public setSeatReservationTime(seconds: number) {
    this.seatReservationTime = seconds;
    return this;
  }

  public hasReservedSeat(sessionId: string): boolean {
    return this.reservedSeats.has(sessionId);
  }

  public setSimulationInterval( callback: SimulationCallback, delay: number = DEFAULT_SIMULATION_INTERVAL ): void {
    // clear previous interval in case called setSimulationInterval more than once
    if ( this._simulationInterval ) { clearInterval( this._simulationInterval ); }

    this._simulationInterval = setInterval( () => {
      this.clock.tick();
      callback(this.clock.deltaTime);
    }, delay );
  }

  public setPatchRate( milliseconds: number ): void {
    // clear previous interval in case called setPatchRate more than once
    if (this._patchInterval) {
      clearInterval(this._patchInterval);
      this._patchInterval = undefined;
    }

    if ( milliseconds !== null && milliseconds !== 0 ) {
      this._patchInterval = setInterval( () => {
        this.broadcastPatch();
        this.broadcastAfterPatch();
      }, milliseconds );
    }
  }

  public setState(newState: T) {
    this.clock.start();

    this._serializer.reset(newState);

    this.state = newState;
  }

  public setMetadata(meta: any) {
    this.metadata = meta;
  }

  public lock(): void {
    // rooms locked internally aren't explicit locks.
    this._lockedExplicitly = (arguments[0] === undefined);

    // skip if already locked.
    if (this._locked) { return; }

    this.emit('lock');

    this._locked = true;
  }

  public unlock(): void {
    // only internal usage passes arguments to this function.
    if (arguments[0] === undefined) {
      this._lockedExplicitly = false;
    }

    // skip if already locked
    if (!this._locked) { return; }

    this.emit('unlock');

    this._locked = false;
  }

  public send(client: Client, data: any): void {
    send[Protocol.ROOM_DATA](client, data);
  }

  public broadcast(data: any, options: BroadcastOptions = {}): boolean {
    if (options.afterNextPatch) {
      delete options.afterNextPatch;
      this._afterNextPatchBroadcasts.push([data, options]);
      return true;
    }

    // no data given, try to broadcast patched state
    if (!data) {
      throw new Error('Room#broadcast: \'data\' is required to broadcast.');
    }

    // encode all messages with msgpack
    if (!(data instanceof Buffer)) {
      data = msgpack.encode(data);
    }

    let numClients = this.clients.length;
    while (numClients--) {
      const client = this.clients[ numClients ];

      if (options.except !== client) {
        send[Protocol.ROOM_DATA](client, data, false);
      }
    }

    return true;
  }

  public async getAvailableData(): Promise<RoomAvailable> {
    return {
      clients: this.clients.length,
      maxClients: this.maxClients,
      metadata: this.metadata,
      roomId: this.roomId,
    };
  }

  public disconnect(): Promise<any> {
    this.isDisconnecting = true;
    this.autoDispose = true;

    const delayedDisconnection = new Promise((resolve) =>
      this.once('disconnect', () => resolve()));

    let numClients = this.clients.length;
    if (numClients > 0) {
      // prevent new clients to join while this room is disconnecting.
      this.lock();

      // clients may have `async onLeave`, room will be disposed after they all run
      while (numClients--) {
        const client = this.clients[numClients];
        const reconnection = this.reconnections[client.sessionId];

        if (reconnection) {
          reconnection.reject();

        } else {
          client.close(WS_CLOSE_CONSENTED);
        }
      }

    } else {
      // no clients connected, dispose immediately.
      this.emit('dispose');
    }

    return delayedDisconnection;
  }

  // see @serialize decorator.
  public get serializer() { return this._serializer.id; }
  protected _getSerializer?(): Serializer<T> {
    return new SchemaSerializer<T>();
  }

  protected sendState(client: Client): void {
    send[Protocol.ROOM_STATE](client, this._serializer.getFullState(client));
  }

  protected broadcastPatch(): boolean {
    if (!this._simulationInterval) {
      this.clock.tick();
    }

    if (!this.state) {
      debugPatch('trying to broadcast null state. you should call #setState');
      return false;
    }

    return this._serializer.applyPatches(this.clients, this.state);
  }

  protected broadcastAfterPatch() {
    const length = this._afterNextPatchBroadcasts.length;

    if (length > 0) {
      for (let i = 0; i < length; i++) {
        this.broadcast.apply(this, this._afterNextPatchBroadcasts[i]);
      }

      // new messages may have been added in the meantime,
      // let's splice the ones that have been processed
      this._afterNextPatchBroadcasts.splice(0, length);
    }
  }

  protected async allowReconnection(client: Client, seconds: number = 15): Promise<Client> {
    if (this.isDisconnecting) {
      throw new Error('disconnecting');
    }

    await this._reserveSeat(client, seconds, true);

    // keep reconnection reference in case the user reconnects into this room.
    const reconnection = new Deferred();
    this.reconnections[client.sessionId] = reconnection;

    // expire seat reservation after timeout
    this.reservedSeatTimeouts[client.sessionId] = setTimeout(() =>
      reconnection.reject(false), seconds * 1000);

    const cleanup = () => {
      this.reservedSeats.delete(client.sessionId);
      delete this.reconnections[client.sessionId];
      delete this.reservedSeatTimeouts[client.sessionId];
    };

    reconnection.
      then(() => {
        clearTimeout(this.reservedSeatTimeouts[client.sessionId]);
        cleanup();
      }).
      catch(() => {
        cleanup();
        this._disposeIfEmpty();
      });

    return await reconnection.promise;
  }

  protected async _reserveSeat(
    client: Client,
    seconds: number = this.seatReservationTime,
    allowReconnection: boolean = false,
  ) {
    if (!allowReconnection && this.hasReachedMaxClients()) {
      return false;
    }

    this.reservedSeats.add(client.sessionId);
    await this.presence.setex(`${this.roomId}:${client.id}`, client.sessionId, seconds);

    if (allowReconnection) {
      // store reference of the roomId this client is allowed to reconnect to.
      await this.presence.setex(client.sessionId, this.roomId, seconds);

    } else {
      this.reservedSeatTimeouts[client.sessionId] = setTimeout(() =>
        this.reservedSeats.delete(client.sessionId), seconds * 1000);

      this.resetAutoDisposeTimeout(seconds);
    }

    return true;
  }

  protected resetAutoDisposeTimeout(timeoutInSeconds: number) {
    clearTimeout(this._autoDisposeTimeout);

    if (!this.autoDispose) {
      return;
    }

    this._autoDisposeTimeout = setTimeout(() => {
      this._autoDisposeTimeout = undefined;
      this._disposeIfEmpty();
    }, timeoutInSeconds * 1000);
  }

  protected _disposeIfEmpty() {
    const willDispose = (
      this.autoDispose &&
      this._autoDisposeTimeout === undefined &&
      this.clients.length === 0 &&
      this.reservedSeats.size === 0
    );

    if (willDispose) {
      this.emit('dispose');
    }

    return willDispose;
  }

  protected _dispose(): Promise<any> {
    let userReturnData;

    if (this.onDispose) {
      userReturnData = this.onDispose();
    }

    if (this._patchInterval) {
      clearInterval(this._patchInterval);
      this._patchInterval = undefined;
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

    return userReturnData || Promise.resolve();
  }

  private _onMessage(client: Client, message: any) {
    message = decode(message);

    if (!message) {
      debugAndPrintError(`${this.roomName} (${this.roomId}), couldn't decode message: ${message}`);
      return;
    }

    if (message[0] === Protocol.ROOM_DATA) {
      this.onMessage(client, message[2]);

    } else if (message[0] === Protocol.LEAVE_ROOM) {
      // stop interpreting messages from this client
      client.removeAllListeners('message');

      // // prevent "onLeave" from being called twice in case the connection is forcibly closed
      // client.removeAllListeners('close');

      // only effectively close connection when "onLeave" is fulfilled
      this._onLeave(client, WS_CLOSE_CONSENTED).then(() => client.terminate());

    } else {
      this.onMessage(client, message);
    }

  }

  private _onJoin(client: Client, options?: any, auth?: any) {
    // create remote client instance.
    this.clients.push( client );

    // delete seat reservation
    this.reservedSeats.delete(client.sessionId);
    if (this.reservedSeatTimeouts[client.sessionId]) {
      clearTimeout(this.reservedSeatTimeouts[client.sessionId]);
      delete this.reservedSeatTimeouts[client.sessionId];
    }

    // clear auto-dispose timeout.
    if (this._autoDisposeTimeout) {
      clearTimeout(this._autoDisposeTimeout);
      this._autoDisposeTimeout = undefined;
    }

    // lock automatically when maxClients is reached
    if (!this._locked && this.clients.length === this.maxClients) {
      this._maxClientsReached = true;
      this.lock.call(this, true);
    }

    // confirm room id that matches the room name requested to join
    send[Protocol.JOIN_ROOM](
      client,
      client.sessionId,
      this._serializer.id,
      this._serializer.handshake && this._serializer.handshake(),
    );

    // bind onLeave method.
    client.on('message', this._onMessage.bind(this, client));
    client.once('close', this._onLeave.bind(this, client));

    // send current state when new client joins the room
    if (this.state) {
      this.sendState(client);
    }

    const reconnection = this.reconnections[client.sessionId];
    if (reconnection) {
      reconnection.resolve(client);

    } else {
      // emit 'join' to room handler
      this.emit('join', client);

      return this.onJoin && this.onJoin(client, options, auth);
    }
  }

  private async _onLeave(client: Client, code?: number): Promise<any> {
    // call abstract 'onLeave' method only if the client has been successfully accepted.
    if (spliceOne(this.clients, this.clients.indexOf(client)) && this.onLeave) {
      try {
        await this.onLeave(client, (code === WS_CLOSE_CONSENTED));

      } catch (e) {
        debugAndPrintError(`onLeave error: ${(e && e.message || e || 'promise rejected')}`);
      }
    }

    this.emit('leave', client);

    // dispose immediatelly if client reconnection isn't set up.
    const willDispose = this._disposeIfEmpty();

    // unlock if room is available for new connections
    if (!willDispose && this._maxClientsReached && !this._lockedExplicitly) {
      this._maxClientsReached = false;
      this.unlock.call(this, true);
    }
  }

}
