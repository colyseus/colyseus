import * as memshared from "memshared";
import * as msgpack from "msgpack-lite";

import { merge, spliceOne } from "./Utils";
import { Client, Protocol, Room, generateId, isValidId } from "./index";

import { debugMatchMaking } from "./Debug";

export type ClientOptions = { clientId: string } & any;

export interface RoomWithScore {
  room: Room;
  score: number;
};

export class MatchMaker {

  private handlers: {[id: string]: any[]} = {};
  private availableRooms: {[name: string]: Room[]} = {};
  private roomsById: {[name: number]: Room} = {};
  private roomCount: number = 0;

  // room references by client id
  protected sessions: {[sessionId: string]: Room} = {};
  protected connectingClientByRoom: {[roomId: string]: {[clientId: string]: any}} = {};

  public execute (client: Client, message: any) {
    if (message[0] == Protocol.JOIN_ROOM) {
      this.onJoinRoomRequest(message[1], message[2], false, (err: string, room: Room) => {
        if (err) {
          let roomId = (room) ? room.roomId : message[1];
          client.send(msgpack.encode([Protocol.JOIN_ERROR, roomId, err]), { binary: true });
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

    if (!this.hasHandler(roomToJoin) && isValidId(roomToJoin)) {
      room = this.joinById(roomToJoin, clientOptions);

    } else {
      room = this.requestToJoinRoom( roomToJoin, clientOptions ).room
        || (allowCreateRoom && this.create( roomToJoin, clientOptions ));
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
    let clientOptions = this.connectingClientByRoom[roomId][client.id];
    let err: string;

    // assign sessionId to socket connection.
    client.sessionId = clientOptions.sessionId;

    delete clientOptions.sessionId;
    delete clientOptions.clientId;

    try {
      (<any>room)._onJoin(client, clientOptions);
      room.once('leave', this.onClientLeaveRoom.bind(this, room));

      this.sessions[ client.sessionId ] = room;

    } catch (e) {
      console.error(room.roomName, "onJoin:", e.stack);
      client.send(msgpack.encode([Protocol.JOIN_ERROR, roomId, e.message]), { binary: true });
    }

    callback(err, room);
  }

  public onLeave (client: Client, room: Room) {
    (<any>room)._onLeave(client, true);
  }

  private onClientLeaveRoom = (room: Room, client: Client, isDisconnect: boolean): boolean => {
    if (isDisconnect) {
      return true;
    }

    delete this.sessions[ client.sessionId ];
  }

  public addHandler (name: string, handler: Function, options: any = {}): void {
    this.handlers[ name ] = [handler, options];
    this.availableRooms[ name ] = [];
  }

  protected hasHandler (name: string) {
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
      console.error(`Error can't join "${ clientOptions.roomName }" with options: ${ JSON.stringify(clientOptions) }`);
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
        let numConnectedClients = availableRoom.clients.length + this.connectingClientByRoom[ availableRoom.roomId ].length;

        // Check maxClients before requesting to join.
        if (numConnectedClients >= availableRoom.maxClients) {
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
      , handler = this.handlers[ roomName ][0]
      , options = this.handlers[ roomName ][1];

    room = new handler();

    // set room options
    room.roomId = generateId();
    room.roomName = roomName;

    if (room.onInit) {
      room.onInit(options);
    }

    // cache on which process the room is living.
    memshared.set(room.roomId, process.pid);

    // imediatelly ask client to join the room
    if ( room.requestJoin(clientOptions) ) {
      debugMatchMaking("spawning '%s' on worker %d", roomName, process.pid);

      room.on('lock', this.lockRoom.bind(this, roomName, room));
      room.on('unlock', this.unlockRoom.bind(this, roomName, room));
      room.once('dispose', this.disposeRoom.bind(this, roomName, room));

      this.roomsById[ room.roomId ] = room;

      // room always start unlocked
      this.unlockRoom(roomName, room);

    } else {
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

    delete this.roomsById[ room.roomId ]

    // remove from cache
    memshared.del(room.roomId);

    // remove from available rooms
    this.lockRoom(roomName, room)
  }

}
