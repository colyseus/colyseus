import http from 'http';
import msgpack from 'notepack.io';

import { Schema } from '@colyseus/schema';
import Clock from '@gamestdio/timer';
import { EventEmitter } from 'events';

import { Presence } from './presence/Presence';

import { SchemaSerializer } from './serializer/SchemaSerializer';
import { Serializer } from './serializer/Serializer';

import { Client, ClientState, decode, Protocol, send } from './Protocol';
import { Deferred, spliceOne } from './Utils';

import { debugAndPrintError, debugPatch } from './Debug';
import { RoomListingData } from './matchmaker/drivers/Driver';
import { FossilDeltaSerializer } from './serializer/FossilDeltaSerializer';

const DEFAULT_PATCH_RATE = 1000 / 20; // 20fps (50ms)
const DEFAULT_SIMULATION_INTERVAL = 1000 / 60; // 60fps (16.66ms)

export const DEFAULT_SEAT_RESERVATION_TIME = Number(process.env.COLYSEUS_SEAT_RESERVATION_TIME || 8);

export type SimulationCallback = (deltaTime: number) => void;

export type RoomConstructor<T= any> = new (presence?: Presence) => Room<T>;

export interface BroadcastOptions {
  except?: Client;
  afterNextPatch?: boolean;
}

export enum RoomInternalState {
  CREATING = 0,
  CREATED = 1,
  DISCONNECTING = 2,
}

export abstract class Room<State= any, Metadata= any> extends EventEmitter {

  public get locked() {
    return this._locked;
  }

  public listing: RoomListingData<Metadata>;
  public clock: Clock = new Clock();

  public roomId: string;
  public roomName: string;

  public maxClients: number = Infinity;
  public patchRate: number = DEFAULT_PATCH_RATE;
  public autoDispose: boolean = true;

  public state: State;
  public presence: Presence;

  public clients: Client[] = [];

  /** @internal */
  public _internalState: RoomInternalState = RoomInternalState.CREATING;

  // seat reservation & reconnection
  protected seatReservationTime: number = DEFAULT_SEAT_RESERVATION_TIME;
  protected reservedSeats: { [sessionId: string]: any } = {};
  protected reservedSeatTimeouts: { [sessionId: string]: NodeJS.Timer } = {};

  protected reconnections: { [sessionId: string]: Deferred } = {};

  private _serializer: Serializer<State> = new FossilDeltaSerializer();
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
  public onCreate?(options: any): void | Promise<any>;
  public onJoin?(client: Client, options?: any, auth?: any): void | Promise<any>;
  public onLeave?(client: Client, consented?: boolean): void | Promise<any>;
  public onDispose?(): void | Promise<any>;
  public onAuth(client: Client, options: any, request?: http.IncomingMessage): any | Promise<any> {
    return true;
  }

  public hasReachedMaxClients(): boolean {
    return (this.clients.length + Object.keys(this.reservedSeats).length) >= this.maxClients;
  }

  public setSeatReservationTime(seconds: number) {
    this.seatReservationTime = seconds;
    return this;
  }

  public hasReservedSeat(sessionId: string): boolean {
    return this.reservedSeats[sessionId] !== undefined;
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
      this._patchInterval = setInterval(() => {
        this.broadcastPatch();
        this.broadcastAfterPatch();
      }, milliseconds);
    }
  }

  public setState(newState: State) {
    this.clock.start();

    if ('_schema' in newState) {
      this._serializer = new SchemaSerializer();

    } else {
      this._serializer = new FossilDeltaSerializer();
    }

    this._serializer.reset(newState);

    this.state = newState;
  }

  public setMetadata(meta: Partial<Metadata>) {
    if (!this.listing.metadata) {
      this.listing.metadata = meta as Metadata;

    } else {
      for (const field in meta) {
        if (!meta.hasOwnProperty(field)) { continue; }
        this.listing.metadata[field] = meta[field];
      }
    }

    if (this._internalState === RoomInternalState.CREATED) {
      this.listing.save();
    }
  }

  public async setPrivate(bool: boolean = true) {
    this.listing.private = bool;

    if (this._internalState === RoomInternalState.CREATED) {
      return await this.listing.save();
    }
  }

  public get metadata() {
    return this.listing.metadata;
  }

  public async lock() {
    // rooms locked internally aren't explicit locks.
    this._lockedExplicitly = (arguments[0] === undefined);

    // skip if already locked.
    if (this._locked) { return; }

    this.emit('lock');

    this._locked = true;

    return await this.listing.updateOne({
      $set: { locked: this._locked },
    });
  }

  public async unlock() {
    // only internal usage passes arguments to this function.
    if (arguments[0] === undefined) {
      this._lockedExplicitly = false;
    }

    // skip if already locked
    if (!this._locked) { return; }

    this.emit('unlock');

    this._locked = false;

    return await this.listing.updateOne({
      $set: { locked: this._locked },
    });
  }

  public send(client: Client, message: any): void {
    if (message instanceof Schema) {
      send.raw(client, [
        Protocol.ROOM_DATA_SCHEMA,
        (message.constructor as typeof Schema)._typeid,
        ...message.encodeAll(),
      ]);

    } else {
      send[Protocol.ROOM_DATA](client, message);
    }
  }

  public broadcast(message: any, options: BroadcastOptions = {}): boolean {
    if (options.afterNextPatch) {
      delete options.afterNextPatch;
      this._afterNextPatchBroadcasts.push([message, options]);
      return true;
    }

    // no data given, try to broadcast patched state
    if (!message) {
      throw new Error('Room#broadcast: \'data\' is required to broadcast.');
    }

    if (message instanceof Schema) {
      const typeId = (message.constructor as typeof Schema)._typeid;
      const encodedMessage = Buffer.from([Protocol.ROOM_DATA_SCHEMA, typeId, ...message.encodeAll()]);

      let numClients = this.clients.length;
      while (numClients--) {
        const client = this.clients[numClients];

        if (options.except !== client) {
          send.raw(client, encodedMessage);
        }
      }

    } else {
      // encode message with msgpack
      const encodedMessage = (!(message instanceof Buffer))
        ? Buffer.from([Protocol.ROOM_DATA, ...msgpack.encode(message)])
        : message;

      let numClients = this.clients.length;
      while (numClients--) {
        const client = this.clients[numClients];

        if (options.except !== client) {
          send.raw(client, encodedMessage);
        }
      }
    }

    return true;
  }

  public disconnect(): Promise<any> {
    this._internalState = RoomInternalState.DISCONNECTING;
    this.autoDispose = true;

    const delayedDisconnection = new Promise((resolve) =>
      this.once('disconnect', () => resolve()));

    for (const reconnection of Object.values(this.reconnections)) {
      reconnection.reject();
    }

    let numClients = this.clients.length;
    if (numClients > 0) {
      // prevent new clients to join while this room is disconnecting.
      this.lock();

      // clients may have `async onLeave`, room will be disposed after they all run
      while (numClients--) {
        this._forciblyCloseClient(this.clients[numClients], Protocol.WS_CLOSE_CONSENTED);
      }
    } else {
      // no clients connected, dispose immediately.
      this.emit('dispose');
    }

    return delayedDisconnection;
  }

  public async ['_onJoin'](client: Client, req?: http.IncomingMessage) {
    const sessionId = client.sessionId;

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
    const options = this.reservedSeats[sessionId];
    delete this.reservedSeats[sessionId];

    // bind clean-up callback when client connection closes
    client.once('close', this._onLeave.bind(this, client));

    client.state = ClientState.JOINING;
    client._enqueuedMessages = [];

    this.clients.push(client);

    const reconnection = this.reconnections[sessionId];
    if (reconnection) {
      reconnection.resolve(client);

    } else {
      try {
        client.auth = await this.onAuth(client, options, req);

        if (!client.auth) {
          throw new Error('onAuth failed.');
        }

        if (this.onJoin) {
          await this.onJoin(client, options, client.auth);
        }
      } catch (e) {
        spliceOne(this.clients, this.clients.indexOf(client));
        debugAndPrintError(e);
        throw e;

      } finally {
        // remove seat reservation
        delete this.reservedSeats[sessionId];
      }
    }

    // emit 'join' to room handler
    this.emit('join', client);

    // allow client to send messages after onJoin has succeeded.
    client.on('message', this._onMessage.bind(this, client));

    // confirm room id that matches the room name requested to join
    send[Protocol.JOIN_ROOM](
      client,
      this._serializer.id,
      this._serializer.handshake && this._serializer.handshake(),
    );
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

  protected allowReconnection(client: Client, seconds: number = Infinity): Deferred {
    if (this._internalState === RoomInternalState.DISCONNECTING) {
      this._disposeIfEmpty(); // gracefully shutting down
      throw new Error('disconnecting');
    }

    const sessionId = client.sessionId;
    this._reserveSeat(sessionId, true, seconds, true);

    // keep reconnection reference in case the user reconnects into this room.
    const reconnection = new Deferred();
    this.reconnections[sessionId] = reconnection;

    if (seconds !== Infinity) {
      // expire seat reservation after timeout
      this.reservedSeatTimeouts[sessionId] = setTimeout(() =>
        reconnection.reject(false), seconds * 1000);
    }

    const cleanup = () => {
      delete this.reservedSeats[sessionId];
      delete this.reconnections[sessionId];
      delete this.reservedSeatTimeouts[sessionId];
    };

    reconnection.
      then(() => {
        client.state = ClientState.RECONNECTED;
        clearTimeout(this.reservedSeatTimeouts[sessionId]);
        cleanup();
      }).
      catch(() => {
        cleanup();
        this._disposeIfEmpty();
      });

    return reconnection;
  }

  protected async _reserveSeat(
    sessionId: string,
    joinOptions: any = true,
    seconds: number = this.seatReservationTime,
    allowReconnection: boolean = false,
  ) {
    if (!allowReconnection && this.hasReachedMaxClients()) {
      return false;
    }

    this.reservedSeats[sessionId] = joinOptions;

    if (!allowReconnection) {
      await this._incrementClientCount();

      this.reservedSeatTimeouts[sessionId] = setTimeout(async () => {
        delete this.reservedSeats[sessionId];
        delete this.reservedSeatTimeouts[sessionId];
        await this._decrementClientCount();
      }, seconds * 1000);

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
      Object.keys(this.reservedSeats).length === 0
    );

    if (willDispose) {
      this.emit('dispose');
    }

    return willDispose;
  }

  protected async _dispose(): Promise<any> {
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

    return await (userReturnData || Promise.resolve());
  }

  private _onMessage(client: Client, message: any) {
    message = decode(message);

    if (!message) {
      debugAndPrintError(`${this.roomName} (${this.roomId}), couldn't decode message: ${message}`);
      return;
    }

    if (message[0] === Protocol.ROOM_DATA) {
      this.onMessage(client, message[1]);

    } else if (message[0] === Protocol.JOIN_ROOM) {
      // join room has been acknowledged by the client
      client.state = ClientState.JOINED;

      // send current state when new client joins the room
      if (this.state) {
        this.sendState(client);
      }

      // dequeue messages sent before client has joined effectively (on user-defined `onJoin`)
      if (client._enqueuedMessages.length > 0) {
        client._enqueuedMessages.forEach((bytes) => send.raw(client, bytes));
      }
      delete client._enqueuedMessages;

    } else if (message[0] === Protocol.LEAVE_ROOM) {
      this._forciblyCloseClient(client, Protocol.WS_CLOSE_CONSENTED);

    } else {
      this.onMessage(client, message);
    }

  }

  private _forciblyCloseClient(client: Client, closeCode: number) {
    // stop receiving messages from this client
    client.removeAllListeners('message');

    // prevent "onLeave" from being called twice if player asks to leave
    const closeListeners: any[] = client.listeners('close');
    if (closeListeners.length >= 2) {
      client.removeListener('close', closeListeners[1]);
    }

    // only effectively close connection when "onLeave" is fulfilled
    this._onLeave(client, closeCode).then(() => client.close(Protocol.WS_CLOSE_NORMAL));
  }

  private async _onLeave(client: Client, code?: number): Promise<any> {
    const success = spliceOne(this.clients, this.clients.indexOf(client));

    // call abstract 'onLeave' method only if the client has been successfully accepted.
    if (success) {
      if (this.onLeave) {
        try {
          await this.onLeave(client, (code === Protocol.WS_CLOSE_CONSENTED));

        } catch (e) {
          debugAndPrintError(`onLeave error: ${(e && e.message || e || 'promise rejected')}`);
        }
      }

      if (client.state !== ClientState.RECONNECTED) {
        this.emit('leave', client);
      }
    }

    // skip next checks if client has reconnected successfully (through `allowReconnection()`)
    if (client.state === ClientState.RECONNECTED) { return; }

    // try to dispose immediatelly if client reconnection isn't set up.
    await this._decrementClientCount();
  }

  private async _incrementClientCount() {
    // lock automatically when maxClients is reached
    if (!this._locked && this.hasReachedMaxClients()) {
      this._maxClientsReached = true;
      this.lock.call(this, true);
    }

    await this.listing.updateOne({
      $inc: { clients: 1 },
      $set: { locked: this._locked },
    });
  }

  private async _decrementClientCount() {
    const willDispose = this._disposeIfEmpty();

    // unlock if room is available for new connections
    if (!willDispose) {
      if (this._maxClientsReached && !this._lockedExplicitly) {
        this._maxClientsReached = false;
        this.unlock.call(this, true);
      }

      // update room listing cache
      await this.listing.updateOne({
        $inc: { clients: -1 },
        $set: { locked: this._locked },
      });
    }
  }

}
