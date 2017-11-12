import * as memshared from "memshared";
import * as msgpack from "msgpack-lite";
import * as EventEmitter from "events";

import { merge, spliceOne } from "./Utils";
import { Client, Room, generateId, isValidId } from "./index";
import { Protocol, decode, send } from "./Protocol";

import { debugMatchMaking } from "./Debug";

export type ClientOptions = { clientId: string } & any;

export interface RoomWithScore {
  room: Room;
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

export class MatchMaker {

  private handlers: {[id: string]: RegisteredHandler} = {};
  private availableRooms: {[name: string]: Room[]} = {};
  private roomsById: {[name: number]: Room} = {};

  // room references by client id
  protected sessions: {[sessionId: string]: Room} = {};
  protected connectingClientByRoom: {[roomId: string]: {[clientId: string]: any}} = {};

  constructor () {
    //
    // nodemon sends SIGUSR2 before reloading
    // (https://github.com/remy/nodemon#controlling-shutdown-of-your-script)
    //
    ['SIGINT', 'SIGTERM', 'SIGUSR2'].forEach(signal => {
      this.gracefullyShutdown(signal);
    });
  }

  public bindClient (client: Client, roomId: string) {
    this.onJoin(roomId, client, (err, room) => {
      if (!err) {
        client.on('message', (message) => {
          if (!(message = decode(message))) {
            return;
          }
          this.execute(client, message);
        });

        client.on('close', (_) => this.onLeave(client, room));
        client.on('error', (e) => console.error("[ERROR]", client.id, e));
      }
    });

  }

  protected execute (client: Client, message: any) {
    if (message[0] == Protocol.JOIN_ROOM) {
      this.onJoinRoomRequest(message[1], message[2], false, (err: string, room: Room) => {
        if (err) {
          let roomId = (room) ? room.roomId : message[1];
          send(client, [Protocol.JOIN_ERROR, roomId, err]);
        }
      });

    } else if (message[0] == Protocol.ROOM_DATA) {
      // send message directly to specific room
      let room = this.getRoomById( message[1] );
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
  public onJoinRoomRequest (roomToJoin: string, clientOptions: ClientOptions, allowCreateRoom: boolean, callback: (err: string, room: Room) => any): void {
    var room: Room;
    let err: string;

    clientOptions.sessionId = generateId();

    if (this.hasHandler(roomToJoin)) {
      room = this.requestToJoinRoom( roomToJoin, clientOptions ).room
        || (allowCreateRoom && this.create( roomToJoin, clientOptions ));

    } else if (isValidId(roomToJoin)) {
      room = this.joinById(roomToJoin, clientOptions);
    }

    if ( room ) {
      //
      // Reserve a seat for clientId
      //
      if (!this.connectingClientByRoom[ room.roomId ]) {
        this.connectingClientByRoom[ room.roomId ] = {};
      }

      this.connectingClientByRoom[ room.roomId ][ clientOptions.clientId ] = clientOptions;

    } else {
      err = "join_request_fail";
    }

    callback(err, room);
  }

  /**
   * Binds target client to the room running in a worker process.
   */
  public onJoin (roomId: string, client: Client, callback: (err: string, room: Room) => any): void {
    let room = this.roomsById[roomId];
    let err: string;
    let clientOptions = this.connectingClientByRoom[roomId] && this.connectingClientByRoom[roomId][client.id];

    if (room && clientOptions) {
      // assign sessionId to socket connection.
      client.sessionId = clientOptions.sessionId;

      delete clientOptions.sessionId;
      delete clientOptions.clientId;

      (<any>room)._onJoin(client, clientOptions);
      room.once('leave', this.onClientLeaveRoom.bind(this, room));

      this.sessions[ client.sessionId ] = room;

      // emit 'join' on registered handler
      this.handlers[room.roomName].emit("join", room, client);

    } else {
      err = "trying to join non-existing room";
      debugMatchMaking(`JOIN_ERROR: ${ err } (roomId: %s, clientOptions: %j)`, roomId, clientOptions);
      send(client, [Protocol.JOIN_ERROR, roomId, err]);
    }

    callback(err, room);
  }

  public onLeave (client: Client, room: Room) {
    (<any>room)._onLeave(client, true);

    // emit 'leave' on registered handler
    this.handlers[room.roomName].emit("leave", room, client);
  }

  private onClientLeaveRoom = (room: Room, client: Client, isDisconnect: boolean): boolean => {
    if (isDisconnect) {
      return true;
    }

    delete this.sessions[ client.sessionId ];
  }

  public registerHandler (name: string, klass: Function, options: any = {}) {
    memshared.sadd("handlers", name);

    let registeredHandler = new RegisteredHandler(klass, options);

    this.handlers[ name ] = registeredHandler;
    this.availableRooms[ name ] = [];

    return registeredHandler;
  }

  public hasHandler (name: string) {
    return this.handlers[ name ] !== undefined;
  }

  public hasAvailableRoom (roomName: string): boolean {
    return (this.availableRooms[ roomName ] &&
      this.availableRooms[ roomName ].length > 0)
  }

  public getRoomById (roomId: number): Room {
    return this.roomsById[ roomId ];
  }

  public joinById (roomId: string, clientOptions: ClientOptions): Room {
    let room = this.roomsById[ roomId ];

    if (!room) {
      console.error(`Error: trying to join non-existant room "${ roomId }"`);

    } else if (!room.requestJoin(clientOptions)) {
      console.error(`Error can't join "${ room.roomName }" with options: ${ JSON.stringify(clientOptions) }`);
      room = undefined;
    }

    return room;
  }

  public requestToJoinRoom (roomName: string, clientOptions: ClientOptions): RoomWithScore {
    let room: Room;
    let bestScore = 0;

    if ( this.hasAvailableRoom( roomName ) ) {
      for ( var i=0; i < this.availableRooms[ roomName ].length; i++ ) {
        let availableRoom = this.availableRooms[ roomName ][ i ];
        let numConnectedClients = availableRoom.clients.length + Object.keys(this.connectingClientByRoom[ availableRoom.roomId ] || {}).length;

        // Check maxClients before requesting to join.
        if (numConnectedClients > availableRoom.maxClients) {
          continue;
        }

        let score = availableRoom.requestJoin(clientOptions) as number;
        if (score > bestScore) {
          bestScore = score;
          room = availableRoom;
        }
      }
    }

    return {
      room: room,
      score: bestScore
    };
  }

  public create (roomName: string, clientOptions: ClientOptions): Room {
    let room = null
      , registeredHandler = this.handlers[ roomName ];

    room = new registeredHandler.klass();

    // set room options
    room.roomId = generateId();
    room.roomName = roomName;

    if (room.onInit) {
      room.onInit(merge({}, clientOptions, registeredHandler.options));
    }

    // cache on which process the room is living.
    memshared.set(room.roomId, process.pid);

    // imediatelly ask client to join the room
    if ( room.requestJoin(clientOptions) ) {
      registeredHandler.emit("create", room);

      debugMatchMaking("spawning '%s' on worker %d", roomName, process.pid);

      room.on('lock', this.lockRoom.bind(this, roomName, room));
      room.on('unlock', this.unlockRoom.bind(this, roomName, room));
      room.once('dispose', this.disposeRoom.bind(this, roomName, room));

      this.roomsById[ room.roomId ] = room;

      // room always start unlocked
      this.unlockRoom(roomName, room);

    } else {
      room._dispose();
      room = null;
    }

    return room;
  }

  private lockRoom (roomName: string, room: Room): void {
    if (this.hasAvailableRoom(roomName)) {
      let roomIndex = this.availableRooms[roomName].indexOf(room);
      if (roomIndex !== -1) {
        // decrease number of rooms spawned on this worker
        memshared.decr(process.pid.toString());
      }
      spliceOne(this.availableRooms[roomName], roomIndex);
    }

    //
    // if current worker doesn't have any 'rooName' handlers available
    // anymore, remove it from the list.
    //
    if (!this.hasAvailableRoom(roomName)) {
      memshared.srem(room.roomName, process.pid);
    }
  }

  private unlockRoom (roomName: string, room: Room) {
    if (this.availableRooms[ roomName ].indexOf(room) === -1) {
      this.availableRooms[ roomName ].push(room)

      // flag current worker has this room id
      memshared.sadd(room.roomName, process.pid);

      // increase number of rooms spawned on this worker
      memshared.incr(process.pid.toString());
    }
  }

  private disposeRoom(roomName: string, room: Room): void {
    debugMatchMaking("disposing '%s' on worker %d", roomName, process.pid);

    // emit disposal on registered session handler
    this.handlers[roomName].emit("dispose", room);

    delete this.roomsById[ room.roomId ]

    // remove from cache
    memshared.del(room.roomId);

    // remove from available rooms
    this.lockRoom(roomName, room)
  }

  private gracefullyShutdown (signal: string) {
    let promises = [];

    for (let roomId in this.roomsById) {
      let room = this.roomsById[roomId];

      // disable autoDispose temporarily, which allow potentially retrieving a
      // Promise from user's `onDispose` method.
      room.autoDispose = false;

      promises.push( room.disconnect() );
      promises.push( (<any>room)._dispose() );

      room.emit('dispose');
    }

    Promise.all(promises).then(() => process.kill(process.pid, signal));
  }

}
