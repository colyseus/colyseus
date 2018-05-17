import * as fossilDelta from 'fossil-delta';
import * as msgpack from 'notepack.io';
import * as shortid from 'shortid';
import * as WebSocket from 'ws';

import { createTimeline, Timeline } from '@gamestdio/timeline';
import Clock from '@gamestdio/timer';
import { EventEmitter } from 'events';

import { Client } from './index';
import { Presence } from './presence/Presence';
import { RemoteClient } from './presence/RemoteClient';
import { decode, Protocol, send } from './Protocol';
import { logError, spliceOne } from './Utils';

import * as jsonPatch from 'fast-json-patch'; // this is only used for debugging patches
import { debugError, debugPatch, debugPatchData } from './Debug';

const DEFAULT_PATCH_RATE = 1000 / 20; // 20fps (50ms)
const DEFAULT_SIMULATION_INTERVAL = 1000 / 60; // 60fps (16.66ms)

export const DEFAULT_SEAT_RESERVATION_TIME = 2;

export type SimulationCallback = (deltaTime?: number) => void;

export interface RoomConstructor<T= any> {
  new (presence?: Presence): Room<T>;
}

export interface RoomAvailable {
  roomId: string;
  clients: number;
  maxClients: number;
  metadata?: any;
}

export interface BroadcastOptions {
  except: Client;
}

export abstract class Room<T= any> extends EventEmitter {
  public clock: Clock = new Clock();
  public timeline?: Timeline;

  public roomId: string;
  public roomName: string;

  public maxClients: number = Infinity;
  public patchRate: number = DEFAULT_PATCH_RATE;
  public autoDispose: boolean = true;

  public state: T;
  public metadata: any;

  public presence: Presence;

  public clients: Client[] = [];
  protected remoteClients: {[sessionId: string]: RemoteClient} = {};

  // seat reservation & reconnection
  protected reservedSeats: Set<string> = new Set();
  protected reservedSeatTimeouts: {[sessionId: string]: NodeJS.Timer} = {};
  protected reconnectionResolvers: {[sessionId: string]: (value?: Client | PromiseLike<Client>) => void} = {};

  // when a new user connects, it receives the '_previousState', which holds
  // the last binary snapshot other users already have, therefore the patches
  // that follow will be the same for all clients.
  private _previousState: any;
  private _previousStateEncoded: any;

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

    this.setPatchRate(this.patchRate);
  }

  // Abstract methods
  public abstract onMessage(client: Client, data: any): void;

  // Optional abstract methods
  public onInit?(options: any): void;
  public onJoin?(client: Client, options?: any, auth?: any): void | Promise<any>;
  public onLeave?(client: Client): void | Promise<any>;
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
    if ( this._patchInterval ) { clearInterval( this._patchInterval ); }

    if ( milliseconds !== null && milliseconds !== 0 ) {
      this._patchInterval = setInterval( this.broadcastPatch.bind(this), milliseconds );
    }
  }

  public useTimeline( maxSnapshots: number = 10 ): void {
    this.timeline = createTimeline( maxSnapshots );
  }

  public setState(newState) {
    this.clock.start();

    this._previousState = newState;

    // ensure state is populated for `sendState()` method.
    this._previousStateEncoded = msgpack.encode( this._previousState );

    this.state = newState;

    if ( this.timeline ) {
      this.timeline.takeSnapshot( this.state );
    }
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
    if (client.readyState === WebSocket.OPEN) {
      send(client, [Protocol.ROOM_DATA, data]);
    }
  }

  public broadcast(data: any, options?: BroadcastOptions): boolean {
    // no data given, try to broadcast patched state
    if (!data) {
      throw new Error('Room#broadcast: \'data\' is required to broadcast.');
    }

    // encode all messages with msgpack
    if (!(data instanceof Buffer)) {
      data = msgpack.encode([Protocol.ROOM_DATA, data]);
    }

    let numClients = this.clients.length;
    while (numClients--) {
      const client = this.clients[ numClients ];

      if (
        client.readyState === WebSocket.OPEN &&
        (!options || options.except !== client)
      ) {
        client.send(data, { binary: true }, logError.bind(this));
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
    const promises = [];

    let i = this.clients.length;
    while (i--) {
      promises.push( this._onLeave(this.clients[i]) );
    }

    return Promise.all(promises);
  }

  protected sendState(client: Client): void {
    send(client, [
      Protocol.ROOM_STATE,
      this._previousStateEncoded,
      this.clock.currentTime,
      this.clock.elapsedTime,
    ]);
  }

  protected broadcastPatch(): boolean {
    if (!this._simulationInterval) {
      this.clock.tick();
    }

    if ( !this.state ) {
      debugPatch('trying to broadcast null state. you should call #setState on constructor or during user connection.');
      return false;
    }

    const currentState = this.state;
    const currentStateEncoded = msgpack.encode( currentState );

    // skip if state has not changed.
    if ( currentStateEncoded.equals( this._previousStateEncoded ) ) {
      return false;
    }

    const patches = fossilDelta.create( this._previousStateEncoded, currentStateEncoded );

    // take a snapshot of the current state
    if (this.timeline) {
      this.timeline.takeSnapshot( this.state, this.clock.elapsedTime );
    }

    //
    // debugging
    //
    if (debugPatch.enabled) {
      debugPatch(`"%s" (roomId: "%s") is sending %d bytes:`, this.roomName, this.roomId, patches.length);
    }

    if (debugPatchData.enabled) {
      debugPatchData('%j', jsonPatch.compare(msgpack.decode(this._previousStateEncoded), currentState));
    }

    this._previousState = currentState;
    this._previousStateEncoded = currentStateEncoded;

    // broadcast patches (diff state) to all clients,
    return this.broadcast( msgpack.encode([ Protocol.ROOM_STATE_PATCH, patches ]) );
  }

  protected allowReconnection(client: Client, seconds: number = 15): Promise<Client> {
    this._reserveSeat(client, seconds, true);

    const reconnection = new Promise<Client>((resolve, reject) => {
      // keep resolver reference in case the user reconnects into this room.
      this.reconnectionResolvers[client.sessionId] = resolve;

      // expire seat reservation after timeout
      this.reservedSeatTimeouts[client.sessionId] = setTimeout(reject, seconds * 1000);
    });

    const cleanup = () => {
      this.reservedSeats.delete(client.sessionId);
      delete this.reconnectionResolvers[client.sessionId];
      delete this.reservedSeatTimeouts[client.sessionId];
    };

    reconnection.
      then(() => {
        clearTimeout(this.reservedSeatTimeouts[client.sessionId]);
        cleanup();
      }).
      catch(cleanup);

    return reconnection;
  }

  protected _reserveSeat(
    client: Client,
    seconds: number = DEFAULT_SEAT_RESERVATION_TIME,
    allowReconnection: boolean = false,
  ) {
    this.presence.setex(`${this.roomId}:${client.id}`, client.sessionId, seconds);
    this.reservedSeats.add(client.sessionId);

    if (allowReconnection) {
      // store reference of the roomId this client is allowed to reconnect to.
      this.presence.setex(client.sessionId, this.roomId, seconds);

    } else {
      this.reservedSeatTimeouts[client.sessionId] = setTimeout(() =>
        this.reservedSeats.delete(client.sessionId), seconds * 1000);
    }

    this.resetAutoDisposeTimeout(seconds);
  }

  protected resetAutoDisposeTimeout(timeoutInSeconds: number) {
    clearTimeout(this._autoDisposeTimeout);

    if (this.clients.length > 0 || !this.autoDispose) {
      return;
    }

    this._autoDisposeTimeout = setTimeout(() =>
      this._disposeIfEmpty(), timeoutInSeconds * 1000);
  }

  protected _disposeIfEmpty() {
    if ( this.clients.length === 0 ) {
      this._dispose();
      this.emit('dispose');
    }
  }

  protected _dispose(): Promise<any> {
    let userReturnData;

    if ( this.onDispose ) { userReturnData = this.onDispose(); }
    if ( this._patchInterval ) { clearInterval( this._patchInterval ); }
    if ( this._simulationInterval ) { clearInterval( this._simulationInterval ); }

    // clear all timeouts/intervals + force to stop ticking
    this.clock.clear();
    this.clock.stop();

    return userReturnData || Promise.resolve();
  }

  // allow remote clients to trigger events on themselves
  private _emitOnClient(sessionId, event) {
    const remoteClient = this.remoteClients[sessionId];

    if (!remoteClient) {
      debugError(`trying to send event ("${event}") to non-existing remote client (${sessionId})`);
      return;
    }

    if (typeof(event) !== 'string') {
      remoteClient.emit('message', new Buffer(event));

    } else {
      remoteClient.emit(event);
    }
  }

  private _onMessage(client: Client, message: any) {
    message = decode(message);

    if (!message) {
      debugError(`${this.roomName} (${this.roomId}), couldn't decode message: ${message}`);
      return;
    }

    if (message[0] === Protocol.ROOM_DATA) {
      this.onMessage(client, message[2]);

    } else {
      this.onMessage(client, message);
    }

  }

  private _onJoin(client: Client, options?: any, auth?: any) {
    // create remote client instance.
    if (client.remote) {
      client = (new RemoteClient(client, this.roomId, this.presence)) as any;
      this.remoteClients[client.sessionId] = client as any;
    }

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
    if (this.clients.length === this.maxClients) {
      this._maxClientsReached = true;
      this.lock.call(this, true);
    }

    // confirm room id that matches the room name requested to join
    send(client, [ Protocol.JOIN_ROOM, client.sessionId ]);

    // bind onLeave method.
    client.on('message', this._onMessage.bind(this, client));
    client.once('close', this._onLeave.bind(this, client));

    // send current state when new client joins the room
    if (this.state) {
      this.sendState(client);
    }

    const isReconnection = this.reconnectionResolvers[client.sessionId];
    if (isReconnection) {
      this.reconnectionResolvers[client.sessionId](client);

    } else {
      // emit 'join' to room handler
      this.emit('join', client);

      return this.onJoin && this.onJoin(client, options, auth);
    }
  }

  private _onLeave(client: Client): void | Promise<any> {
    let userReturnData;

    // call abstract 'onLeave' method only if the client has been successfully accepted.
    if (spliceOne(this.clients, this.clients.indexOf(client)) && this.onLeave) {
      userReturnData = this.onLeave(client);
    }

    this.emit('leave', client);

    // remove remote client reference
    if (client instanceof RemoteClient) {
      delete this.remoteClients[client.sessionId];
    }

    // dispose immediatelly if client reconnection isn't set up.
    if (!this.reservedSeats.has(client.sessionId) && this.autoDispose) {
      this._disposeIfEmpty();
    }

    // unlock if room is available for new connections
    if (this._maxClientsReached && !this._lockedExplicitly) {
      this._maxClientsReached = false;
      this.unlock.call(this, true);
    }

    return userReturnData || Promise.resolve();
  }

}
