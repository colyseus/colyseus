import * as msgpack from "notepack.io";
import * as EventEmitter from "events";
import * as WebSocket from "ws";

import { merge, spliceOne, registerGracefulShutdown } from "./Utils";

import { Client, generateId, isValidId } from "./index";
import { Protocol, decode, send } from "./Protocol";

import { Room } from "./Room";
import { RemoteRoom } from "./presence/RemoteRoom";
import { RoomList } from './RoomList';

import { Presence } from './presence/Presence';
import { LocalPresence } from './presence/LocalPresence';

import { debugMatchMaking, debugErrors } from "./Debug";

export type ClientOptions = { clientId: string } & any;

export interface RoomWithScore {
  roomId: string;
  score: number;
};

export class RegisteredHandler extends EventEmitter {
  klass: any;
  options: any;

  constructor (klass: any, options: any) {
    super();

    this.klass = klass;
    this.options = options;
  }
}

const REMOTE_ROOM_SCOPE_TIMEOUT = 8000; // remote room calls timeout

export class MatchMaker {
  private handlers: {[id: string]: RegisteredHandler} = {};

  private localRooms = new RoomList<Room>();
  private presence: Presence;

  // room references by client id
  protected sessions: {[sessionId: string]: Room | RemoteRoom} = {};
  protected isGracefullyShuttingDown: boolean = false;

  constructor (presence?: Presence) {
    this.presence = presence || new LocalPresence();
  }

  public async connectToRoom (client: Client, roomId: string) {
    let err: string;

    const room = this.localRooms.getById(roomId);
    const clientOptions = client.options;

    // assign sessionId to socket connection.
    client.sessionId = await this.presence.hget(roomId, client.id);

    // clean temporary data
    delete clientOptions.sessionId;
    delete clientOptions.clientId;

    if (this.localRooms.getById(roomId)) {
      this.sessions[client.sessionId] = room;
      try {
        (<any>room)._onJoin(client, clientOptions, client.auth);

      } catch (e) {
        err = e.message || e;
        debugErrors(e.stack || e);
      }

    } else {
      this.sessions[client.sessionId] = new RemoteRoom(roomId, this);

      let remoteSessionSub = `${roomId}:${client.sessionId}`;

      this.presence.subscribe(remoteSessionSub, (message) => {
        let [method, data] = message;

        if (method === "send") {
          client.send(new Buffer(data), { binary: true });

        } else if (method === "close") {
          console.log("remote client received 'close' from room:", client.sessionId);
          client.close(data);
        }
      });

      try {
        await this.remoteRoomCall(roomId, "_onJoin", [{
          id: client.id,
          sessionId: client.sessionId,
          remote: true,
        }, clientOptions, client.auth]);

      } catch (e) {
        err = e.message || e;
        debugErrors(e.stack || e);
      }

      client.once('close', (_) => {
        console.log("remote client is closing connection:", client.sessionId);
        this.presence.unsubscribe(remoteSessionSub);
        this.remoteRoomCall(roomId, "_triggerOnRemoteClient", [client.sessionId, 'close']);
        delete this.sessions[client.sessionId];
      });
    }

    // clear reserved seat of connecting client into the room
    this.presence.hdel(roomId, client.id);

    client.on('message', (message) => this.onRoomMessage(client, message));

    if (err) {
      send(client, [Protocol.JOIN_ERROR, `${client.sessionId} couldn't connect to room "${roomId}": ${err}`]);
      client.close();
    }
  }

  protected onRoomMessage (client: Client, message: any) {
    if (!(message = decode(message))) {
      return;
    }

    if (message[0] == Protocol.ROOM_DATA) {
      // send message directly to specific room
      (<Room>this.sessions[ client.sessionId ]).onMessage(client, message[2]);

    } else {
      (<Room>this.sessions[ client.sessionId ]).onMessage(client, message);
    }

  }

  /**
   * Create/joins a particular client in a room running in a worker process.
   *
   * The client doesn't join instantly because this method is called from the
   * match-making process. The client will request a new WebSocket connection
   * to effectively join into the room created/joined by this method.
   */
  public async onJoinRoomRequest (client: Client, roomToJoin: string, clientOptions: ClientOptions): Promise<string> {
    let err: string;

    let roomId: string;
    let isCreating: boolean = false;

    clientOptions.sessionId = generateId();

    if (this.hasHandler(roomToJoin)) {
      let bestRoomByScore = await this.getAvailableRoomByScore(roomToJoin, clientOptions);
      if (bestRoomByScore && bestRoomByScore.roomId) {
        roomToJoin = bestRoomByScore.roomId;

      } else {
        isCreating = true;
        roomId = this.create(roomToJoin, clientOptions);
      }
    } 

    if (!isCreating && isValidId(roomToJoin)) {
      roomId = await this.joinById(roomToJoin, clientOptions);
    }

    if (roomId) {
      // Reserve a seat for clientId
      this.presence.hset(roomId, client.id, clientOptions.sessionId);

    } else {
      console.log("throw error!");
      throw new Error("join_request_fail");
    }

    return roomId;
  }

  public async remoteRoomCall (roomId: string, method: string, args?: any[]) {
    const room = this.localRooms.getById(roomId);

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
          let [code, data] = message;
          if (code === Protocol.IPC_SUCCESS) {
            resolve(data);

          } else if (code === Protocol.IPC_ERROR) {
            reject(data);
          }
          unsubscribe();
        });

        this.presence.publish(roomId, [method, requestId, args]);

        unsubscribeTimeout = setTimeout(() => {
          unsubscribe();
          reject(Protocol.IPC_TIMEOUT);
        }, REMOTE_ROOM_SCOPE_TIMEOUT);
      });

    } else {
      if (!args && typeof(room[method]) !== "function") {
        return room[method];
      }

      return room[method].apply(room, args);
    }
  }

  private onClientJoinRoom (room: Room, client: Client) {
    this.handlers[room.roomName].emit("join", room, client);
  }

  private onClientLeaveRoom (room: Room, client: Client) {
    this.handlers[room.roomName].emit("leave", room, client);
    delete this.sessions[ client.sessionId ];
  }

  public registerHandler (name: string, klass: Function, options: any = {}) {
    let registeredHandler = new RegisteredHandler(klass, options);

    this.handlers[ name ] = registeredHandler;
    this.localRooms[ name ] = [];

    return registeredHandler;
  }

  public hasHandler (name: string) {
    return this.handlers[ name ] !== undefined;
  }

  public hasAvailableRoom (roomName: string): boolean {
    return (this.localRooms[ roomName ] &&
      this.localRooms[ roomName ].length > 0)
  }

  public async joinById (roomId: string, clientOptions: ClientOptions): Promise<string> {
    let exists = await this.presence.exists(roomId);

    if (!exists) {
      console.error(`Error: trying to join non-existant room "${ roomId }"`);
      return;

    } else if (await this.remoteRoomCall(roomId, "hasReachedMaxClients")) {
      console.error(`Error: roomId "${ roomId }" reached maxClients.`);
      return;

    } else if (!(await this.remoteRoomCall(roomId, "requestJoin", [clientOptions, false]))) {
      console.error(`Error: can't join "${ roomId }" with options: ${ JSON.stringify(clientOptions) }`);
      return;
    }

    return roomId;
  }

  public async getAvailableRoomByScore (roomName: string, clientOptions: ClientOptions): Promise<RoomWithScore> {
    let roomsWithScore = (await this.getRoomsWithScore(roomName, clientOptions)).
      sort((a, b) => b.score - a.score);;

    return roomsWithScore[0];
  }

  protected async getRoomsWithScore (roomName: string, clientOptions: ClientOptions): Promise<RoomWithScore[]> {
    let roomsWithScore: RoomWithScore[] = [];
    let roomIds = await this.presence.smembers(roomName);
    let remoteRequestJoins = [];

    await Promise.all(roomIds.map(async (roomId) => {
      let maxClientsReached = await this.remoteRoomCall(roomId, 'hasReachedMaxClients');

      // check maxClients before requesting to join.
      if (maxClientsReached) { return; }

      const localRoom = this.localRooms.getById(roomId);
      if (!localRoom) {
        remoteRequestJoins.push(new Promise(async (resolve, reject) => {
          let score = await this.remoteRoomCall(roomId, 'requestJoin', [clientOptions, false]);
          resolve({ roomId, score });
        }));

      } else {
        roomsWithScore.push({
          score: localRoom.requestJoin(clientOptions, false) as number,
          roomId: roomId
        });
      }

      return true;
    }));

    return (await Promise.all(remoteRequestJoins)).concat(roomsWithScore);
  }

  public create (roomName: string, clientOptions: ClientOptions): string {
    let room = null
      , registeredHandler = this.handlers[ roomName ];

    room = new registeredHandler.klass(this.presence);

    // set room options
    room.roomId = generateId();
    room.roomName = roomName;

    if (room.onInit) {
      room.onInit(merge({}, clientOptions, registeredHandler.options));
    }

    // imediatelly ask client to join the room
    if ( room.requestJoin(clientOptions, true) ) {
      debugMatchMaking("spawning '%s' on process %d", roomName, process.pid);

      room.on('lock', this.lockRoom.bind(this, roomName, room));
      room.on('unlock', this.unlockRoom.bind(this, roomName, room));
      room.on('join', this.onClientJoinRoom.bind(this, room));
      room.on('leave', this.onClientLeaveRoom.bind(this, room));
      room.once('dispose', this.disposeRoom.bind(this, roomName, room));

      this.localRooms.setById(room.roomId, room);

      // room always start unlocked
      this.createRoomReferences(room);

      registeredHandler.emit("create", room);

    } else {
      room._dispose();
      room = null;
    }

    return room && room.roomId;
  }

  private lockRoom (roomName: string, room: Room): void {
    this.clearRoomReferences(room);

    // emit public event on registered handler
    this.handlers[room.roomName].emit("lock", room);
  }

  private unlockRoom (roomName: string, room: Room) {
    if (this.createRoomReferences(room)) {

      // emit public event on registered handler
      this.handlers[room.roomName].emit("unlock", room);
    }
  }

  private disposeRoom(roomName: string, room: Room): void {
    debugMatchMaking("disposing '%s' on process %d", roomName, process.pid);

    // emit disposal on registered session handler
    this.handlers[roomName].emit("dispose", room);

    delete this.localRooms.byId[ room.roomId ]

    // remove from available rooms
    this.clearRoomReferences(room);
  }

  protected createRoomReferences (room: Room): boolean {
    if (this.localRooms[ room.roomName ].indexOf(room) === -1) {
      this.localRooms[ room.roomName ].push(room)

      // cache on which process the room is living.
      this.presence.sadd(room.roomName, room.roomId);

      this.presence.subscribe(room.roomId, (message) => {
        let [ method, requestId, args ] = message;

        const reply = (data) => {
          this.presence.publish(`${room.roomId}:${requestId}`, data);
        };

        // reply with property value
        if (!args && typeof(room[method]) !== "function") {
          return reply([Protocol.IPC_SUCCESS, room[method]]);
        }

        // reply with method result
        let response: any;

        try {
          response = room[method].apply(room, args);

        } catch (e) {
          debugErrors(e.stack || e);
          return reply([Protocol.IPC_ERROR, e.message || e]);
        }

        if (!(response instanceof Promise)) return reply([Protocol.IPC_SUCCESS, response]);

        response.
          then(result => reply([Protocol.IPC_SUCCESS, result])).
          catch(e => {
            debugErrors(e.stack || e);
            reply([Protocol.IPC_ERROR, e.message || e])
          });
      });

      return true;
    }
  }

  protected clearRoomReferences (room: Room) {
    if (this.hasAvailableRoom(room.roomName)) {
      let roomIndex = this.localRooms[room.roomName].indexOf(room);
      if (roomIndex !== -1) {
        this.presence.srem(room.roomName, room.roomId);
        // this.presence.unregisterRoom(roomName, room.roomId, process.pid);
      }

      // clear list of connecting clients.
      this.presence.del(room.roomId);

      spliceOne(this.localRooms[room.roomName], roomIndex);
    }
  }

  public gracefullyShutdown () {
    if (this.isGracefullyShuttingDown) {
      return Promise.reject(false);
    }

    this.isGracefullyShuttingDown = true;

    let promises = [];

    for (let roomId in this.localRooms.byId) {
      let room = this.localRooms.byId[roomId];

      // disable autoDispose temporarily, which allow potentially retrieving a
      // Promise from user's `onDispose` method.
      room.autoDispose = false;

      promises.push( room.disconnect() );
      promises.push( (<any>room)._dispose() );

      room.emit('dispose');
    }

    return Promise.all(promises);
  }

}