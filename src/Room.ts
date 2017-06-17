import * as msgpack from "msgpack-lite";
import * as fossilDelta from "fossil-delta";
import * as shortid from "shortid";

import ClockTimer from "clock-timer.js";
import { EventEmitter } from "events";
import { createTimeline, Timeline } from "timeframe";

import { Client } from "./index";
import { Protocol } from "./Protocol";
import { logError, spliceOne, toJSON } from "./Utils";

export abstract class Room<T=any> extends EventEmitter {

  public clock: ClockTimer = new ClockTimer();
  public timeline?: Timeline;

  public roomId: string;
  public roomName: string;

  public clients: Client[] = [];

  public maxClients: number = Infinity;
  public patchRate: number = 1000 / 20; // Default patch rate is 20fps (50ms)
  public autoDispose: boolean = true;

  public state: T;
  public options: any;

  // when a new user connects, it receives the '_previousState', which holds
  // the last binary snapshot other users already have, therefore the patches
  // that follow will be the same for all clients.
  protected _previousState: any;
  protected _previousStateEncoded: any;

  private _simulationInterval: NodeJS.Timer;
  private _patchInterval: number;

  constructor () {
    super();

    if (arguments.length > 0) {
      console.warn("DEPRECATION WARNING: use 'onInit(options)' instead of 'constructor(options)' to initialize the room.");
    }

    this.setPatchRate(this.patchRate);
  }

  abstract onInit (options: any): void;
  abstract onMessage (client: Client, data: any): void;
  abstract onJoin (client: Client, options?: any): void;
  abstract onLeave (client: Client): void;
  abstract onDispose (): void;

  public requestJoin (options: any): number | boolean {
    return 1;
  }

  public setSimulationInterval ( callback: Function, delay: number = 1000 / 60 ): void {
    // clear previous interval in case called setSimulationInterval more than once
    if ( this._simulationInterval ) clearInterval( this._simulationInterval );

    this._simulationInterval = setInterval( () => {
      this.clock.tick();
      callback();
    }, delay );
  }

  public setPatchRate ( milliseconds: number ): void {
    // clear previous interval in case called setPatchRate more than once
    if ( this._patchInterval ) clearInterval(this._patchInterval);

    this._patchInterval = setInterval( this.broadcastPatch.bind(this), milliseconds );
  }

  public useTimeline ( maxSnapshots: number = 10 ): void {
    this.timeline = createTimeline( maxSnapshots );
  }

  public setState (newState) {
    this.clock.start();

    // ensure state is populated for `sendState()` method.
    this._previousState = toJSON( newState );
    this._previousStateEncoded = msgpack.encode( this._previousState );

    this.state = newState;

    if ( this.timeline ) {
      this.timeline.takeSnapshot( this.state );
    }
  }

  public lock (): void {
    this.emit('lock');
  }

  public unlock (): void {
    this.emit('unlock');
  }

  public send (client: Client, data: any): void {
    client.send( msgpack.encode( [Protocol.ROOM_DATA, this.roomId, data] ), { binary: true }, logError.bind(this) );
  }

  public broadcast (data: any): boolean {
    // no data given, try to broadcast patched state
    if (!data) {
      throw new Error("Room#broadcast: 'data' is required to broadcast.");
    }

    // encode all messages with msgpack
    if (!(data instanceof Buffer)) {
      data = msgpack.encode([Protocol.ROOM_DATA, this.roomId, data]);
    }

    var numClients = this.clients.length;
    while (numClients--) {
      this.clients[ numClients ].send(data, { binary: true }, logError.bind(this) );
    }

    return true;
  }

  public disconnect (): void {
    var i = this.clients.length;
    while (i--) {
      this._onLeave(this.clients[i]);
    }
  }

  protected sendState (client: Client): void {
    client.send( msgpack.encode( [
      Protocol.ROOM_STATE,
      this.roomId,
      this._previousState,
      this.clock.currentTime,
      this.clock.elapsedTime,
    ] ), {
      binary: true
    }, logError.bind(this) );
  }

  private broadcastPatch (): boolean {
    if ( !this._previousState ) {
      throw new Error( 'trying to broadcast null state. you should call #setState on constructor or during user connection.' );
    }

    let currentState = toJSON( this.state );
    let currentStateEncoded = msgpack.encode( currentState );

    // skip if state has not changed.
    if ( currentStateEncoded.equals( this._previousStateEncoded ) ) {
      return false;
    }

    let patches = fossilDelta.create( this._previousStateEncoded, currentStateEncoded );

    // take a snapshot of the current state
    if (this.timeline) {
      this.timeline.takeSnapshot( this.state, this.clock.elapsedTime );
    }

    this._previousState = currentState;
    this._previousStateEncoded = currentStateEncoded;

    // broadcast patches (diff state) to all clients,
    // even if nothing has changed in order to calculate PING on client-side
    return this.broadcast( msgpack.encode([ Protocol.ROOM_STATE_PATCH, this.roomId, patches ]) );
  }

  private _onJoin (client: Client, options?: any): void {
    this.clients.push( client );

    // confirm room id that matches the room name requested to join
    client.send( msgpack.encode( [Protocol.JOIN_ROOM, client.sessionId] ), { binary: true }, logError.bind(this) );

    // send current state when new client joins the room
    if (this.state) {
      this.sendState(client);
    }

    if (this.onJoin) {
      this.onJoin(client, options);
    }
  }

  private _onLeave (client: Client, isDisconnect: boolean = false): void {
    // Remove client from client list
    if (!spliceOne(this.clients, this.clients.indexOf(client))) {
      // skip if the client already left.
      return;
    }

    if (this.onLeave) this.onLeave(client);

    this.emit('leave', client, isDisconnect);

    //
    // TODO: force disconnect from server.
    //
    // need to check why the connection is being re-directed to MatchMaking
    // process after calling `client.close()` here
    //
    if (!isDisconnect) {
      client.send( msgpack.encode( [Protocol.LEAVE_ROOM, this.roomId] ), { binary: true }, logError.bind(this) );
    }

    // custom cleanup method & clear intervals
    if ( this.clients.length == 0 && this.autoDispose ) {
      if ( this.onDispose ) this.onDispose();
      if ( this._patchInterval ) clearInterval( this._patchInterval );
      if ( this._simulationInterval ) clearInterval( this._simulationInterval );

      this.emit('dispose');
    }
  }

}
