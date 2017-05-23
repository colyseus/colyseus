import * as memshared from "memshared";
import * as msgpack from "msgpack-lite";

import { merge, spliceOne } from "./Utils";
import { Client, Protocol, Room, generateId } from "./index";

export class MatchMaker {

  private handlers: {[id: string]: any[]} = {};
  private availableRooms: {[name: string]: Room<any>[]} = {};
  private roomsById: {[name: number]: Room<any>} = {};
  private roomCount: number = 0;

  // room references by client id
  protected clients: {[id: string]: Room<any>} = {};

  public execute (client: Client, message: any) {
    if (message[0] == Protocol.JOIN_ROOM) {
      this.onJoinRoomRequest(message[1], message[2], (err: string, room: Room<any>) => {
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

  public onJoinRoomRequest (roomToJoin: number | string, clientOptions: any, callback: (err: string, room: Room<any>) => any): void {
    var room: Room<any>;
    let err: string;

    if (typeof(roomToJoin)==="string") {
      room = this.joinOrCreateByName(roomToJoin, clientOptions || {});

    } else {
      room = this.joinById(roomToJoin, clientOptions);
    }

    if ( room ) {
      // TODO: JOIN_ROOM when 'client' is available
      //
      // try {
      //   (<any>room)._onJoin(client, clientOptions);
      //
      // } catch (e) {
      //   console.error(room.roomName, "onJoin:", e.stack);
      //   err = e.message;
      // }
      //
      // room.once('leave', this.onClientLeaveRoom.bind(this, room));
      // this.clients[ client.id ] = room;

    } else {
      err = "join_request_fail";
    }

    callback(err, room);
  }

  private onClientLeaveRoom = (room: Room<any>, client: Client, isDisconnect: boolean): boolean => {
    if (isDisconnect) {
      return true;
    }
    delete this.clients[ client.id ];
  }

  public addHandler (name: string, handler: Function, options: any = {}): void {
    this.handlers[ name ] = [handler, options];
    this.availableRooms[ name ] = [];
  }

  public hasHandler (roomName: string): boolean {
    return this.handlers[ roomName ] !== undefined;
  }

  public hasAvailableRoom (roomName: string): boolean {
    return (this.availableRooms[ roomName ] &&
      this.availableRooms[ roomName ].length > 0)
  }

  public getRoomById (roomId: number): Room<any> {
    return this.roomsById[ roomId ];
  }

  public joinById (roomId: number, clientOptions: any): Room<any> {
    let room = this.roomsById[ roomId ];

    if (!room) {
      console.error(`Error: trying to join non-existant room "${ roomId }"`);

    } else if (!room.requestJoin(clientOptions)) {
      console.error(`Error can't join "${ clientOptions.roomName }" with options: ${ JSON.stringify(clientOptions) }`);
      room = undefined;
    }

    return room;
  }

  public joinOrCreateByName (roomName: string, clientOptions: any): Room<any> {
    if (!this.hasHandler(roomName)) {
      console.error(`Error: no available handler for "${ roomName }"`);

    } else {
      return this.requestJoin( roomName, clientOptions )
        || this.create( roomName, clientOptions );
    }
  }

  public requestJoin (roomName: string, clientOptions: any): Room<any> {
    let room: Room<any>;

    if ( this.hasAvailableRoom( roomName ) ) {
      for ( var i=0; i < this.availableRooms[ roomName ].length; i++ ) {
        let availableRoom = this.availableRooms[ roomName ][ i ];

        if ( availableRoom.requestJoin(clientOptions) ) {
          room = availableRoom;
          break;
        }
      }
    }

    return room;
  }

  public create (roomName: string, clientOptions: any): Room<any> {
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

  private lockRoom (roomName: string, room: Room<any>): void {
    if (this.hasAvailableRoom(roomName)) {
      let index = this.availableRooms[roomName].indexOf(room);
      if (index !== -1) {
        spliceOne(this.availableRooms[roomName], index);
      }
    }
  }

  private unlockRoom (roomName: string, room: Room<any>) {
    if (this.availableRooms[ roomName ].indexOf(room) === -1) {
      this.availableRooms[ roomName ].push(room)
    }
  }

  private disposeRoom(roomName: string, room: Room<any>): void {
    delete this.roomsById[ room.roomId ]

    // remove from available rooms
    this.lockRoom(roomName, room)
  }

}
