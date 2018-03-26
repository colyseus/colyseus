import * as EventEmitter from 'events';
import * as msgpack from 'notepack.io';
import * as WebSocket from 'ws';

import { merge, registerGracefulShutdown, spliceOne } from './Utils';

import { Client, generateId, isValidId } from './index';
import { IpcProtocol, Protocol, send } from './Protocol';

import { RegisteredHandler } from './matchmaker/RegisteredHandler';
import { Room, RoomAvailable, RoomConstructor } from './Room';

import { LocalPresence } from './presence/LocalPresence';
import { Presence } from './presence/Presence';

import { debugErrors, debugMatchMaking } from './Debug';

export type ClientOptions = any;

export interface RoomWithScore {
  roomId: string;
  score: number;
}

const PRESENCE_TIMEOUT = Number(process.env.COLYSEUS_PRESENCE_TIMEOUT || 8000); // remote room calls timeout

export class MatchMaker {
  protected isGracefullyShuttingDown: boolean = false;

  private handlers: {[id: string]: RegisteredHandler} = {};
  private localRooms: {[roomId: string]: Room} = {};

  private presence: Presence;

  constructor(presence?: Presence) {
    this.presence = presence || new LocalPresence();
  }

  public async connectToRoom(client: Client, roomId: string) {
    let err: string;

    const room = this.localRooms[roomId];
    const clientOptions = client.options;
    const auth = client.auth;

    // assign sessionId to socket connection.
    client.sessionId = await this.presence.hget(roomId, client.id);

    // clean temporary data
    delete clientOptions.auth;
    delete clientOptions.requestId;
    delete client.options;

    if (this.localRooms[roomId]) {
      try {
        (room as any)._onJoin(client, clientOptions, client.auth);

      } catch (e) {
        err = e.message || e;
        debugErrors(e.stack || e);
      }

    } else {
      const remoteSessionSub = `${roomId}:${client.sessionId}`;

      this.presence.subscribe(remoteSessionSub, (message) => {
        const [method, data] = message;

        if (method === 'send') {
          client.send(new Buffer(data), { binary: true });

        } else if (method === 'close') {
          client.close(data);
        }
      });

      await this.remoteRoomCall(roomId, '_onJoin', [{
        id: client.id,
        remote: true,
        sessionId: client.sessionId,
      }, clientOptions, client.auth]);

      // forward 'message' events to room's process
      client.on('message', (data: Buffer) => {
        this.remoteRoomCall(roomId, '_emitOnClient', [client.sessionId, Array.from(data)]);
      });

      // forward 'close' events to room's process
      client.once('close', (_) => {
        this.presence.unsubscribe(remoteSessionSub);
        this.remoteRoomCall(roomId, '_emitOnClient', [client.sessionId, 'close']);
      });
    }

    // clear reserved seat of connecting client into the room
    this.presence.hdel(roomId, client.id);
  }

  /**
   * Create or joins the client into a particular room
   *
   * The client doesn't join instantly because this method is called from the
   * match-making process. The client will request a new WebSocket connection
   * to effectively join into the room created/joined by this method.
   */
  public async onJoinRoomRequest(client: Client, roomToJoin: string, clientOptions: ClientOptions): Promise<string> {
    const hasHandler = this.hasHandler(roomToJoin);
    let roomId: string;

    if (!hasHandler && isValidId(roomToJoin)) {
      roomId = roomToJoin;
    }

    if (!hasHandler && !isValidId(roomToJoin)) {
      throw new Error('join_request_fail');
    }

    clientOptions.sessionId = generateId();

    // check if there's an existing room with provided name available to join
    if (hasHandler) {
      const bestRoomByScore = (await this.getAvailableRoomByScore(roomToJoin, clientOptions))[0];
      if (bestRoomByScore && bestRoomByScore.roomId) {
        roomId = bestRoomByScore.roomId;
      }
    }

    if (isValidId(roomId)) {
      roomId = await this.joinById(roomId, clientOptions);
    }

    // if couldn't join a room by its id, let's try to create a new one
    if (!roomId && hasHandler) {
      roomId = this.create(roomToJoin, clientOptions);
    }

    if (roomId) {
      // Reserve a seat for client id
      this.presence.hset(roomId, client.id, clientOptions.sessionId);

    } else {
      throw new Error('join_request_fail');
    }

    return roomId;
  }

  public async remoteRoomCall(roomId: string, method: string, args?: any[]) {
    const room = this.localRooms[roomId];

    if (!room) {
      return new Promise((resolve, reject) => {
        let unsubscribeTimeout: NodeJS.Timer;

        const requestId = generateId();
        const channel = `${roomId}:${requestId}`;

        const unsubscribe = () => {
          this.presence.unsubscribe(channel);
          clearTimeout(unsubscribeTimeout);
        };

        this.presence.subscribe(channel, (message) => {
          const [code, data] = message;
          if (code === IpcProtocol.SUCCESS) {
            resolve(data);

          } else if (code === IpcProtocol.ERROR) {
            reject(data);
          }
          unsubscribe();
        });

        this.presence.publish(this.getRoomChannel(roomId), [method, requestId, args]);

        unsubscribeTimeout = setTimeout(() => {
          unsubscribe();
          reject(new Error("remote room timed out"));
        }, PRESENCE_TIMEOUT);
      });

    } else {
      if (!args && typeof(room[method]) !== 'function') {
        return room[method];
      }

      return room[method].apply(room, args);
    }
  }

  public registerHandler(name: string, klass: RoomConstructor, options: any = {}) {
    const registeredHandler = new RegisteredHandler(klass, options);

    this.handlers[ name ] = registeredHandler;

    return registeredHandler;
  }

  public hasHandler(name: string) {
    return this.handlers[ name ] !== undefined;
  }

  public async joinById(roomId: string, clientOptions: ClientOptions): Promise<string> {
    const exists = await this.presence.exists(this.getRoomChannel(roomId));

    if (!exists) {
      debugErrors(`trying to join non-existant room "${ roomId }"`);
      return;

    } else if (await this.remoteRoomCall(roomId, 'hasReachedMaxClients')) {
      debugErrors(`room "${ roomId }" reached maxClients.`);
      return;

    } else if (!(await this.remoteRoomCall(roomId, 'requestJoin', [clientOptions, false]))) {
      debugErrors(`can't join room "${ roomId }" with options: ${ JSON.stringify(clientOptions) }`);
      return;
    }

    return roomId;
  }

  public async getAvailableRoomByScore(roomName: string, clientOptions: ClientOptions): Promise<RoomWithScore[]> {
    return (await this.getRoomsWithScore(roomName, clientOptions)).
      sort((a, b) => b.score - a.score);
  }

  public create(roomName: string, clientOptions: ClientOptions): string {
    const registeredHandler = this.handlers[ roomName ];
    const room = new registeredHandler.klass(this.presence);

    // set room options
    room.roomId = generateId();
    room.roomName = roomName;

    if (room.onInit) {
      room.onInit(merge({}, clientOptions, registeredHandler.options));
    }

    // imediatelly ask client to join the room
    if ( room.requestJoin(clientOptions, true) ) {
      debugMatchMaking('spawning \'%s\' on process %d', roomName, process.pid);

      room.on('lock', this.lockRoom.bind(this, roomName, room));
      room.on('unlock', this.unlockRoom.bind(this, roomName, room));
      room.on('join', this.onClientJoinRoom.bind(this, room));
      room.on('leave', this.onClientLeaveRoom.bind(this, room));
      room.once('dispose', this.disposeRoom.bind(this, roomName, room));

      // room always start unlocked
      this.createRoomReferences(room);

      registeredHandler.emit('create', room);

      return room.roomId;

    } else {
      (room as any)._dispose();
      return undefined;
    }
  }

  public async getAvailableRooms(roomName: string): Promise<RoomAvailable[]> {
    const roomIds = await this.presence.smembers(roomName);
    const availableRooms: RoomAvailable[] = [];

    await Promise.all(roomIds.map(async (roomId) => {
      const availability: RoomAvailable = await this.remoteRoomCall(roomId, 'getAvailableData');

      if (availability) {
        availableRooms.push(availability);
      }

      return true;
    }));

    return availableRooms;
  }

  // used only for testing purposes
  public getRoomById (roomId: string) {
    return this.localRooms[roomId];
  }

  public gracefullyShutdown() {
    if (this.isGracefullyShuttingDown) {
      return Promise.reject(false);
    }

    this.isGracefullyShuttingDown = true;

    const promises = [];

    for (const roomId in this.localRooms) {
      if (!this.localRooms.hasOwnProperty(roomId)) {
        continue;
      }

      const room = this.localRooms[roomId];

      // disable autoDispose temporarily, which allow potentially retrieving a
      // Promise from user's `onDispose` method.
      room.autoDispose = false;

      promises.push( room.disconnect() );
      promises.push( (room as any)._dispose() );

      room.emit('dispose');
    }

    return Promise.all(promises);
  }

  protected async getRoomsWithScore(roomName: string, clientOptions: ClientOptions): Promise<RoomWithScore[]> {
    const roomsWithScore: RoomWithScore[] = [];
    const roomIds = await this.presence.smembers(roomName);
    const remoteRequestJoins = [];

    await Promise.all(roomIds.map(async (roomId) => {
      const maxClientsReached = await this.remoteRoomCall(roomId, 'hasReachedMaxClients');

      // check maxClients before requesting to join.
      if (maxClientsReached) { return; }

      const localRoom = this.localRooms[roomId];
      if (!localRoom) {
        remoteRequestJoins.push(new Promise(async (resolve, reject) => {
          const score = await this.remoteRoomCall(roomId, 'requestJoin', [clientOptions, false]);
          resolve({ roomId, score });
        }));

      } else {
        roomsWithScore.push({
          roomId,
          score: localRoom.requestJoin(clientOptions, false) as number,
        });
      }

      return true;
    }));

    return (await Promise.all(remoteRequestJoins)).concat(roomsWithScore);
  }

  protected createRoomReferences(room: Room): boolean {
    if (!this.localRooms[room.roomId]) {
      this.localRooms[room.roomId] = room;

      // cache on which process the room is living.
      this.presence.sadd(room.roomName, room.roomId);

      this.presence.subscribe(this.getRoomChannel(room.roomId), (message) => {
        const [ method, requestId, args ] = message;

        const reply = (data) => {
          this.presence.publish(`${room.roomId}:${requestId}`, data);
        };

        // reply with property value
        if (!args && typeof(room[method]) !== 'function') {
          return reply([IpcProtocol.SUCCESS, room[method]]);
        }

        // reply with method result
        let response: any;
        try {
          response = room[method].apply(room, args);

        } catch (e) {
          debugErrors(e.stack || e);
          return reply([IpcProtocol.ERROR, e.message || e]);
        }

        if (!(response instanceof Promise)) {
          return reply([IpcProtocol.SUCCESS, response]);
        }

        response.
          then((result) => reply([IpcProtocol.SUCCESS, result])).
          catch((e) => {
            debugErrors(e.stack || e);
            reply([IpcProtocol.ERROR, e.message || e]);
          });
      });

      return true;
    }
  }

  protected clearRoomReferences(room: Room) {
    if (this.localRooms[room.roomId]) {
      this.presence.srem(room.roomName, room.roomId);

      // clear list of connecting clients.
      this.presence.del(room.roomId);

      delete this.localRooms[room.roomId];
    }
  }

  protected getRoomChannel(roomId) {
    return `$${roomId}`;
  }

  private onClientJoinRoom(room: Room, client: Client) {
    this.handlers[room.roomName].emit('join', room, client);
  }

  private onClientLeaveRoom(room: Room, client: Client) {
    this.handlers[room.roomName].emit('leave', room, client);
  }

  private lockRoom(roomName: string, room: Room): void {
    this.clearRoomReferences(room);

    // emit public event on registered handler
    this.handlers[room.roomName].emit('lock', room);
  }

  private unlockRoom(roomName: string, room: Room) {
    if (this.createRoomReferences(room)) {

      // emit public event on registered handler
      this.handlers[room.roomName].emit('unlock', room);
    }
  }

  private disposeRoom(roomName: string, room: Room): void {
    debugMatchMaking('disposing \'%s\' on process %d', roomName, process.pid);

    // emit disposal on registered session handler
    this.handlers[roomName].emit('dispose', room);

    // remove from available rooms
    this.clearRoomReferences(room);

    // unsubscribe from remote connections
    this.presence.unsubscribe(this.getRoomChannel(room.roomId));
  }

}
