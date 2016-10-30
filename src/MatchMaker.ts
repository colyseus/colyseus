import { merge, spliceOne } from "./Utils";
import { Room } from "./Room";
import { Client } from "./index";

export class MatchMaker {

  private handlers: {[id: string]: any[]} = {};
  private availableRooms: {[name: string]: Room<any>[]} = {};
  private roomsById: {[name: number]: Room<any>} = {};
  private roomCount: number = 0;

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

  public joinById (client: Client, roomId: number, clientOptions: any): Room<any> {
    let room = this.roomsById[ roomId ];
    if (!room) { throw new Error(`room doesn't exists`); }

    if (!room.requestJoin(clientOptions)) {
      throw new Error(`Can't join ${ clientOptions.roomName }`);
    }
    room._onJoin(client, clientOptions)

    return room;
  }

  public joinOrCreateByName (client: Client, roomName: string, clientOptions: any): Room<any> {

    // throw error
    if (!this.hasHandler(roomName)) {
      throw new Error(`no handler for "${ roomName }"`);
    }

    let room = ( this.requestJoin( client, roomName, clientOptions )
      || this.create( client, roomName, clientOptions ) );

    if (room) room._onJoin(client, clientOptions);

    return room;

  }

  public requestJoin (client: Client, roomName: string, clientOptions: any): Room<any> {
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

  public create (client: Client, roomName: string, clientOptions: any): Room<any> {
    let room = null
      , handler = this.handlers[ roomName ][0]
      , options = this.handlers[ roomName ][1];

    // TODO:
    // keep track of available roomId's
    // try to use 0~127 in order to have lesser Buffer size
    options.roomId = this.roomCount++;
    options.roomName = roomName;

    // Room#requestJoin may fail on constructor
    room = new handler(merge(clientOptions, options));

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
