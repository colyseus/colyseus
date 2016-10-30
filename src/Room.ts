import { EventEmitter } from "events";
import { Protocol } from "./Protocol";
import { logError, spliceOne, toJSON } from "./Utils";

import ClockTimer from "clock-timer.js";
import { createTimeline, Timeline } from "timeframe";

import * as msgpack from "msgpack-lite";
import * as fossilDelta from "fossil-delta";
import * as WebSocket from "ws";

export abstract class Room<T> extends EventEmitter {

  public clock: ClockTimer = new ClockTimer();
  public timeline?: Timeline;

  public roomId: number;
  public roomName: string;

  protected clients: WebSocket[] = [];
  protected options: any;

  public state: T;
  protected _previousState: any;

  private _simulationInterval: NodeJS.Timer;
  private _patchInterval: number;

  constructor ( options: any = {}) {
    super()

    this.roomId = options.roomId
    this.roomName = options.roomName

    this.options = options

    // Default patch rate is 20fps (50ms)
    this.setPatchRate( 1000 / 20 )
  }

  abstract onMessage (client: WebSocket, data: any): void;
  abstract onJoin (client: WebSocket, options?: any): void;
  abstract onLeave (client: WebSocket): void;
  abstract onDispose (): void;

  public requestJoin (options: any): boolean {
    return true;
  }

  setSimulationInterval ( callback: Function, delay: number = 1000 / 60 ): void {
    // clear previous interval in case called setSimulationInterval more than once
    if ( this._simulationInterval ) clearInterval( this._simulationInterval );

    this._simulationInterval = setInterval( () => {
      this.clock.tick();
      callback();
    }, delay );
  }

  setPatchRate ( milliseconds: number ): void {
    // clear previous interval in case called setPatchRate more than once
    if ( this._patchInterval ) clearInterval(this._patchInterval);

    this._patchInterval = setInterval( this.patch.bind(this), milliseconds );
  }

  useTimeline ( maxSnapshots: number = 10 ): void {
    this.timeline = createTimeline( maxSnapshots );
  }

  setState (newState) {
    this.clock.start();

    this._previousState = this.getEncodedState();
    this.state = newState;

    if ( this.timeline ) {
      this.timeline.takeSnapshot( this.state );
    }
  }

  lock (): void {
    this.emit('lock')
  }

  unlock (): void {
    this.emit('unlock')
  }

  send (client: WebSocket, data: any): void {
    client.send( msgpack.encode( [Protocol.ROOM_DATA, this.roomId, data] ), { binary: true }, logError.bind(this) )
  }

  sendState (client: WebSocket): void {
    client.send( msgpack.encode( [
      Protocol.ROOM_STATE,
      this.roomId,
      toJSON( this.state ),
      this.clock.currentTime,
      this.clock.elapsedTime,
    ] ), {
      binary: true
    }, logError.bind(this) )
  }

  broadcastState (): boolean {
    return this.broadcast( msgpack.encode([
      Protocol.ROOM_STATE,
      this.roomId,
      toJSON( this.state )
    ]) );
  }

  broadcastPatch (): boolean {
    if ( !this._previousState ) {
      throw new Error( 'trying to broadcast null state. you should call #setState on constructor or during user connection.' );
    }

    let newState = this.getEncodedState()

    // skip if state has not changed.
    if ( newState.equals( this._previousState ) ) {
      return false;
    }

    let patches = fossilDelta.create( this._previousState, newState );

    // take a snapshot of the current state
    if (this.timeline) {
      this.timeline.takeSnapshot( this.state, this.clock.elapsedTime );
    }

    this._previousState = newState;

    // broadcast patches (diff state) to all clients,
    // even if nothing has changed in order to calculate PING on client-side
    return this.broadcast( msgpack.encode([ Protocol.ROOM_STATE_PATCH, this.roomId, patches ]) );
  }

  broadcast (data?: any): boolean {
    // no data given, try to broadcast patched state
    if (!data) {
      return this.broadcastPatch() ;
    }

    // encode all messages with msgpack
    if (!(data instanceof Buffer)) {
      data = msgpack.encode([Protocol.ROOM_DATA, this.roomId, data])
    }

    var numClients = this.clients.length;
    while (numClients--) {
      this.clients[ numClients ].send(data, { binary: true }, logError.bind(this) )
    }

    return true
  }

  patch (): void {
    // broadcast patched state to all clients
    this.broadcastPatch()
  }

  _onMessage (client, data) {
    if (this.onMessage) {
      this.onMessage(client, data);
    }
  }

  _onJoin (client: WebSocket, options?: any): void {
    this.clients.push( client )

    // confirm room id that matches the room name requested to join
    client.send( msgpack.encode( [Protocol.JOIN_ROOM, this.roomId, this.roomName] ), { binary: true }, logError.bind(this) )

    // send current state when new client joins the room
    if (this.state) {
      this.sendState(client);
    }

    if (this.onJoin) {
      this.onJoin(client, options);
    }
  }

  _onLeave (client: WebSocket, isDisconnect: boolean = false): void {
    // remove client from client list
    spliceOne(this.clients, this.clients.indexOf(client))

    if (this.onLeave) this.onLeave(client)

    this.emit('leave', client, isDisconnect)

    if (!isDisconnect) {
      client.send( msgpack.encode( [Protocol.LEAVE_ROOM, this.roomId] ), { binary: true }, logError.bind(this) )
    }

    // custom cleanup method & clear intervals
    if ( this.clients.length == 0 ) {
      if ( this.onDispose ) this.onDispose();
      if ( this._patchInterval ) clearInterval( this._patchInterval )
      if ( this._simulationInterval ) clearInterval( this._simulationInterval )

      this.emit('dispose')
    }
  }

  getEncodedState () {
    return msgpack.encode( toJSON( this.state ) )
  }

  disconnect (): void {
    var i = this.clients.length;
    while (i--) {
      this._onLeave(this.clients[i]);
    }
  }

}
