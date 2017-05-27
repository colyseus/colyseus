import * as memshared from "memshared";
import * as msgpack from "msgpack-lite";

import { merge, spliceOne } from "./Utils";
import { Client, Protocol, Room, generateId, isValidId } from "./index";

export type ClientOptions = { clientId: string } & any;

export class MatchMaker {

  private handlers: {[id: string]: any[]} = {};
  private availableRooms: {[name: string]: Room[]} = {};
  private roomsById: {[name: number]: Room} = {};
  private roomCount: number = 0;

  // room references by client id
  protected clients: {[id: string]: Room} = {};
  protected connectingClientByRoom: {[roomId: string]: string[]} = {};

  public execute (client: Client, message: any) {
    if (message[0] == Protocol.JOIN_ROOM) {
      this.onJoinRoomRequest(message[1], message[2], false, (err: string, room: Room) => {
        if (err) {
          let roomId = (room) ? room.roomId : message[1];
          client.send(msgpack.encode([Protocol.JOIN_ERROR, roomId, err]), { binary: true });
          if (room) { (<any>room)._onLeave(client); }
        }
      });

    } else if (message[0] == Protocol.LEAVE_ROOM) {
      // trigger onLeave directly to specific room
      let room = this.getRoomById( message[1] );
      if (room) { (<any>room)._onLeave(client); }

    } else if (message[0] == Protocol.ROOM_DATA) {
      // send message directly to specific room
      let room = this.getRoomById( message[1] );
      if (room) { room.onMessage(client, message[2]); }

    } else {
      this.clients[ client.id ].onMessage(client, message);
    }

  }

  public onJoinRoomRequest (roomToJoin: string, clientOptions: ClientOptions, allowCreateRoom: boolean, callback: (err: string, room: Room) => any): void {
    var room: Room;
    let err: string;

    if (isValidId(roomToJoin)) {
      room = this.joinById(roomToJoin, clientOptions);

    } else {
      room = this.requestToJoinRoom( roomToJoin, clientOptions )
        || (allowCreateRoom && this.create( roomToJoin, clientOptions ));
    }

    if ( room ) {
      //
      // Reserve a seat for clientId
      //
      if (!this.connectingClientByRoom[ room.roomId ]) {
        this.connectingClientByRoom[ room.roomId ] = [];
      }

      this.connectingClientByRoom[ room.roomId ].push(clientOptions.clientId);

    } else {
      err = "join_request_fail";
    }

    callback(err, room);
  }

  // TODO:
  public onJoin (roomId: string, client: Client, clientOptions: ClientOptions, callback: (err: string, room: Room) => any): void {
      let room = this.roomsById[roomId];
      let err: string;

      try {
        (<any>room)._onJoin(client, clientOptions);

      } catch (e) {
        console.error(room.roomName, "onJoin:", e.stack);
        err = e.message;
      }

      room.once('leave', this.onClientLeaveRoom.bind(this, room));
      this.clients[ client.id ] = room;

      callback(err, room);
  }

  private onClientLeaveRoom = (room: Room, client: Client, isDisconnect: boolean): boolean => {
    if (isDisconnect) {
      return true;
    }
    delete this.clients[ client.id ];
  }

  public addHandler (name: string, handler: Function, options: any = {}): void {
    this.handlers[ name ] = [handler, options];
    this.availableRooms[ name ] = [];
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

  public requestToJoinRoom (roomName: string, clientOptions: ClientOptions): Room {
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

        let score = availableRoom.requestJoin(clientOptions);
        if (score > bestScore) {
          bestScore = score;
          room = availableRoom;
        }
      }
    }

    return room;
  }

  public create (roomName: string, clientOptions: ClientOptions): Room {
    let room = null
      , handler = this.handlers[ roomName ][0]
      , options = this.handlers[ roomName ][1];

    // TODO:
    // keep track of available roomId's
    // try to use 0~127 in order to have lesser Buffer size
    options.roomId = generateId();
    options.roomName = roomName;

    room = new handler(merge(clientOptions, options));

    // imediatelly ask client to join the room
    if ( room.requestJoin(clientOptions) ) {
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
      let index = this.availableRooms[roomName].indexOf(room);
      if (index !== -1) {
        spliceOne(this.availableRooms[roomName], index);
      }
    }
  }

  private unlockRoom (roomName: string, room: Room) {
    if (this.availableRooms[ roomName ].indexOf(room) === -1) {
      this.availableRooms[ roomName ].push(room)
    }
  }

  private disposeRoom(roomName: string, room: Room): void {
    delete this.roomsById[ room.roomId ]

    // remove from available rooms
    this.lockRoom(roomName, room)
  }

}
