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

import { debugMatchMaking } from "./Debug";

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

const REMOTE_ROOM_SCOPE_TIMEOUT = 400;

export class MatchMaker {
  private handlers: {[id: string]: RegisteredHandler} = {};

  private localRooms = new RoomList<Room>();
  private remoteRooms = new RoomList<RemoteRoom>();

  private presence: Presence;

  // room references by client id
  protected sessions: {[sessionId: string]: Room} = {};
  protected isGracefullyShuttingDown: boolean = false;

  constructor (presence?: Presence) {
    this.presence = presence || new LocalPresence();
  }

  public async bindRoom (client: Client, roomId: string) {
    const room = this.localRooms.getById(roomId);
    const clientOptions = client.options;

    // assign sessionId to socket connection.
    client.sessionId = await this.presence.hget(roomId, "sessionId");

    // clean temporary data
    delete clientOptions.sessionId;
    delete clientOptions.clientId;

    // this.remoteRoomCall(roomId, "_onJoin", [])
    (<any>room)._onJoin(client, clientOptions);
    room.once('leave', this.onClientLeaveRoom.bind(this, room));

    this.sessions[ client.sessionId ] = room;

    // emit 'join' on registered handler
    this.handlers[room.roomName].emit("join", room, client);

    // register 'close' event early on. the client might disconnect before successfully joining the requested room
    client.on('close', (_) => this.onLeave(client, roomId));
    client.on('message', (message) => this.onRoomMessage(client, message));
  }

  protected onRoomMessage (client: Client, message: any) {
    if (!(message = decode(message))) {
      return;
    }

    if (message[0] == Protocol.JOIN_ROOM) {
      this.onJoinRoomRequest(message[1], message[2], false).
        catch((err) => send(client, [Protocol.JOIN_ERROR, message[1], err]));

    } else if (message[0] == Protocol.ROOM_DATA) {
      // send message directly to specific room
      let room = this.localRooms.getById(message[1]);
      if (room) { room.onMessage(client, message[2]); }

    } else {
      this.sessions[ client.sessionId ].onMessage(client, message);
    }

  }

  /**
   * Create/joins a particular client in a room running in a worker process.
   *
   * The client doesn't join instantly because this method is called from the
   * match-making process. The client will request a new WebSocket connection
   * to effectively join into the room created/joined by this method.
   */
  public async onJoinRoomRequest (client: Client, roomToJoin: string, clientOptions: ClientOptions, allowCreateRoom: boolean = true): Promise<Room> {
    let room: Room;
    let err: string;

    clientOptions.sessionId = generateId();

    if (this.hasHandler(roomToJoin)) {
      let bestRoomByScore = await this.getAvailableRoomByScore(roomToJoin, clientOptions);
      let roomId = bestRoomByScore && bestRoomByScore.roomId;

      room = (roomId && this.localRooms.getById(roomId))
        || (allowCreateRoom && this.create(roomToJoin, clientOptions));

    } else if (isValidId(roomToJoin)) {
      room = this.joinById(roomToJoin, clientOptions);
    }

    if (room) {
      // Reserve a seat for clientId
      this.presence.hset(room.roomId, "sessionId", clientOptions.sessionId);
      room.connectingClients[clientOptions.clientId] = clientOptions;

    } else {
      console.log("throw error!");
      throw new Error("join_request_fail");
    }

    return room;
  }

  public async remoteRoomCall (roomId: string, method: string, args?: any[]) {
    const room = this.localRooms.getById(roomId);

    if (!room) {
      return new Promise((resolve, reject) => {
        const requestId = generateId();
        const channel = `${roomId}:${requestId}`;
        const unsubscribe = () => this.presence.unsubscribe(channel);

        this.presence.subscribe(channel, (data) => {
          console.log("LETS RESOLVE!", data);
          resolve(data);
          unsubscribe();
        });

        this.presence.publish(roomId, [method, requestId, args]);

        setTimeout(() => {
          unsubscribe();
          reject();
        }, REMOTE_ROOM_SCOPE_TIMEOUT);
      });

    } else {
      console.log("LETS CALL", method, "ON LOCAL ROOM:", room.roomId);
      return room[method].apply(room, args);
    }
  }

  public onLeave (client: Client, roomId: string) {
    let room = this.localRooms.getById(roomId);
    if (!room) {
      // TODO: when gracefully shutting down, _onLeave is called manually per client,
      // and the room may not exist anymore when receiving the 'close' event.
      return;
    }

    (<any>room)._onLeave(client, true);

    // emit 'leave' on registered handler
    this.handlers[room.roomName].emit("leave", room, client);
  }

  private onClientLeaveRoom (room: Room, client: Client, isDisconnect: boolean): boolean {
    if (isDisconnect) {
      return true;
    }

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

  public joinById (roomId: string, clientOptions: ClientOptions): Room {
    let room = this.localRooms.getById(roomId);

    if (!room) {
      console.error(`Error: trying to join non-existant room "${ roomId }"`);

    } else if (room.maxClientsReached) {
      console.error(`Error: roomId "${ roomId }" reached maxClients.`);
      room = undefined;

    } else if (!room.requestJoin(clientOptions, false)) {
      console.error(`Error: can't join "${ room.roomName }" with options: ${ JSON.stringify(clientOptions) }`);
      room = undefined;
    }

    return room;
  }

  public async getAvailableRoomByScore (roomName: string, clientOptions: ClientOptions): Promise<RoomWithScore> {
    console.log("getAvailableRoomByScore...")
    let roomsWithScore = (await this.getRoomsWithScore(roomName, clientOptions)).
      sort((a, b) => b.score - a.score);;

    console.log("rooms with score:", roomsWithScore);

    return roomsWithScore[0];
  }

  protected async getRoomsWithScore (roomName: string, clientOptions: ClientOptions): Promise<RoomWithScore[]> {
    console.log("getRoomsWithScore...");
    let roomsWithScore: RoomWithScore[] = [];
    let roomIds = await this.presence.smembers(roomName);
    let remoteRequestJoins = [];

    roomIds.forEach(roomId => {
      console.log("roomId, is local?", roomId, typeof(this.localRooms.getById(roomId)));
      if (!this.localRooms.getById(roomId)) {
        remoteRequestJoins.push(this.remoteRoomCall(roomId, 'requestJoin', [clientOptions, false]));

      } else {
        let room = this.localRooms.getById(roomId);

        // check maxClients before requesting to join.
        if (room.maxClientsReached) { return; }

        roomsWithScore.push({
          score: room.requestJoin(clientOptions, false) as number,
          roomId: room.roomId
        });
      }
    });

    let remoteScores = await Promise.all(remoteRequestJoins);
    return roomsWithScore.concat(remoteScores);
  }

  public create (roomName: string, clientOptions: ClientOptions): Room {
    console.log('lets create room', roomName, clientOptions);
    let room = null
      , registeredHandler = this.handlers[ roomName ];

    room = new registeredHandler.klass();

    // set room options
    room.roomId = generateId();
    room.roomName = roomName;

    if (room.onInit) {
      room.onInit(merge({}, clientOptions, registeredHandler.options));
    }

    // imediatelly ask client to join the room
    if ( room.requestJoin(clientOptions, true) ) {
      debugMatchMaking("spawning '%s' on worker %d", roomName, process.pid);

      room.on('lock', this.lockRoom.bind(this, roomName, room));
      room.on('unlock', this.unlockRoom.bind(this, roomName, room));
      room.once('dispose', this.disposeRoom.bind(this, roomName, room));

      this.localRooms.setById(room.roomId, room);

      // room always start unlocked
      this.createRoomReferences(room);

      registeredHandler.emit("create", room);

    } else {
      room._dispose();
      room = null;
    }

    return room;
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
    debugMatchMaking("disposing '%s' on worker %d", roomName, process.pid);

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
        console.log("RECEIVED MESSAGE:", message);

        let [ method, requestId, args ] = message;
        const reply = (data) => {
          console.log("LETS REPLY WITH", data);
          this.presence.publish(`${room.roomId}:${requestId}`, data);
        };

        console.log(`LETS EXECUTE REMOTE COMMAND: ${room.roomId}, ${method}, ARGS: ${JSON.stringify(args)}`);

        let response = room[method].apply(room, args);
        if (!(response instanceof Promise)) return reply(response);

        response.
          then((result) => reply(result)).
          catch(e => console.error("ERROR EXECUTING REMOTE COMMAND:", room.roomId, method, args));
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