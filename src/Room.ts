import * as msgpack from "notepack.io";
import * as fossilDelta from "fossil-delta";
import * as shortid from "shortid";

import Clock from "@gamestdio/timer";
import { EventEmitter } from "events";
import { createTimeline, Timeline } from "@gamestdio/timeline";

import { Client } from "./index";
import { Protocol, send, decode } from "./Protocol";
import { logError, spliceOne } from "./Utils";
import { Presence } from './presence/Presence';
import { RemoteClient } from "./presence/RemoteClient";

import { debugPatch, debugPatchData } from "./Debug";
import * as jsonPatch from "fast-json-patch"; // this is only used for debugging patches

const DEFAULT_PATCH_RATE = 1000 / 20; // 20fps (50ms)
const DEFAULT_SIMULATION_INTERVAL = 1000 / 60; // 60fps (16.66ms)

export abstract class Room<T=any> extends EventEmitter {
  public clock: Clock = new Clock();
  public timeline?: Timeline;

  public roomId: string;
  public roomName: string;

  public clients: Client[] = [];
  protected remoteClients: {[sessionId: string]: RemoteClient} = {};

  public maxClients: number = Infinity;
  public patchRate: number = DEFAULT_PATCH_RATE; 
  public autoDispose: boolean = true;

  public state: T;
  public metadata: any;

  protected presence: Presence;

  // when a new user connects, it receives the '_previousState', which holds
  // the last binary snapshot other users already have, therefore the patches
  // that follow will be the same for all clients.
  protected _previousState: any;
  protected _previousStateEncoded: any;

  private _simulationInterval: NodeJS.Timer;
  private _patchInterval: NodeJS.Timer;

  private locked: boolean = false;
  private _maxClientsReached: boolean = false;

  constructor (presence?: Presence) {
    super();
    this.presence = presence;
    this.setPatchRate(this.patchRate);
  }

  // Abstract methods
  abstract onMessage (client: Client, data: any): void;

  // Optional abstract methods
  onInit? (options: any): void;
  onJoin? (client: Client, options?: any, auth?: any): void | Promise<any>;
  onLeave? (client: Client): void | Promise<any>;
  onDispose? (): void | Promise<any>;

  public requestJoin (options: any, isNew?: boolean): number | boolean {
    return 1;
  }

  public verifyClient (client: Client, options: any): boolean | Promise<any> {
    return Promise.resolve(true);
  }

  public async hasReachedMaxClients (): Promise<boolean> {
    let connectingClients = (await this.presence.hlen(this.roomId));
    return this.clients.length + connectingClients >= this.maxClients;
  }

  public setSimulationInterval ( callback: Function, delay: number = DEFAULT_SIMULATION_INTERVAL ): void {
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

    this._previousState = newState;

    // ensure state is populated for `sendState()` method.
    this._previousStateEncoded = msgpack.encode( this._previousState );

    this.state = newState;

    if ( this.timeline ) {
      this.timeline.takeSnapshot( this.state );
    }
  }

  public setMetadata (meta: any) {
    this.metadata = meta;
  }

  public lock (): void {
    this.locked = true;
    this.emit('lock');
  }

  public unlock (): void {
    this.locked = false;
    this.emit('unlock');
  }

  public send (client: Client, data: any): void {
    send(client, [ Protocol.ROOM_DATA, data ]);
  }

  public broadcast (data: any): boolean {
    // no data given, try to broadcast patched state
    if (!data) {
      throw new Error("Room#broadcast: 'data' is required to broadcast.");
    }

    // encode all messages with msgpack
    if (!(data instanceof Buffer)) {
      data = msgpack.encode([Protocol.ROOM_DATA, data]);
    }

    let numClients = this.clients.length;
    while (numClients--) {
      (<Client>this.clients[ numClients ]).send(data, { binary: true }, logError.bind(this) );
    }

    return true;
  }

  public disconnect (): Promise<any> {
    let promises = [];

    let i = this.clients.length;
    while (i--) {
      promises.push( this._onLeave((<Client>this.clients[i])) );
    }

    return Promise.all(promises);
  }

  protected sendState (client: Client): void {
    send(client, [
      Protocol.ROOM_STATE,
      this._previousStateEncoded,
      this.clock.currentTime,
      this.clock.elapsedTime,
    ]);
  }

  private broadcastPatch (): boolean {
    if ( !this.state ) {
      debugPatch('trying to broadcast null state. you should call #setState on constructor or during user connection.');
      return false;
    }

    let currentState = this.state;
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

    //
    // debugging
    //
    if (debugPatch.enabled) {
      debugPatch(`"%s" (roomId: "%s") is sending %d bytes:`, this.roomName, this.roomId, patches.length);
    }

    if (debugPatchData.enabled) {
      debugPatchData("%j", jsonPatch.compare(msgpack.decode(this._previousStateEncoded), currentState));
    }

    this._previousState = currentState;
    this._previousStateEncoded = currentStateEncoded;

    // broadcast patches (diff state) to all clients,
    return this.broadcast( msgpack.encode([ Protocol.ROOM_STATE_PATCH, patches ]) );
  }

  // allow remote clients to trigger events on themselves
  private _emitOnClient (sessionId, event) {
    let remoteClient = this.remoteClients[sessionId];

    if (!remoteClient) {
      console.error(this.roomId, "REMOTE CLIENT NOT FOUND:", sessionId, `(event: ${event})`);
      return;
    }

    if (typeof(event) !== "string") {
      remoteClient.emit('message', new Buffer(event));

    } else {
      remoteClient.emit(event);
    }
  }

  private _onMessage (client: Client, message: any) {
    if (!(message = decode(message))) { return; }

    if (message[0] == Protocol.ROOM_DATA) {
      this.onMessage(client, message[2]);

    } else {
      this.onMessage(client, message);
    }

  }

  private _onJoin (client: Client, options?: any, auth?: any) {
    // create remote client instance.
    if (client.remote) {
      client = <any> (new RemoteClient(client, this.roomId, this.presence));
      this.remoteClients[client.sessionId] = <any> client;
    }

    this.clients.push( client );

    // lock automatically when maxClients is reached
    if (this.clients.length === this.maxClients) {
      this._maxClientsReached = true;
      this.lock();
    }

    // confirm room id that matches the room name requested to join
    send(client, [ Protocol.JOIN_ROOM, client.sessionId ]);

    // emit 'join' to room handler
    this.emit('join', client);

    // bind onLeave method.
    client.on('message', this._onMessage.bind(this, client));
    client.once('close', this._onLeave.bind(this, client));

    // send current state when new client joins the room
    if (this.state) {
      this.sendState(client);
    }

    if (this.onJoin) {
      return this.onJoin(client, options, auth);
    }
  }

  private _onLeave (client: Client): void | Promise<any> {
    let userReturnData;

    // call abstract 'onLeave' method only if the client has been successfully accepted.
    if (spliceOne(this.clients, this.clients.indexOf(client)) && this.onLeave) {
      userReturnData = this.onLeave(client);
    }

    // remove remote client reference
    if (client instanceof RemoteClient) {
      delete this.remoteClients[client.sessionId];
    }

    this.emit('leave', client);

    // custom cleanup method & clear intervals
    if ( this.autoDispose ) {
      this._disposeIfEmpty();
    }

    // unlock if room is available for new connections
    if (this._maxClientsReached && this.locked) {
      this.unlock();
    }

    return userReturnData || Promise.resolve();
  }

  protected _disposeIfEmpty () {
    if ( this.clients.length == 0 ) {
      this._dispose();
      this.emit('dispose');
    }
  }

  protected _dispose (): Promise<any> {
    let userReturnData;

    if ( this.onDispose ) userReturnData = this.onDispose();
    if ( this._patchInterval ) clearInterval( this._patchInterval );
    if ( this._simulationInterval ) clearInterval( this._simulationInterval );

    // clear all timeouts/intervals + force to stop ticking
    this.clock.clear();
    this.clock.stop();

    return userReturnData || Promise.resolve();
  }

}
