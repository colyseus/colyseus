import * as http from "http";

import { EventEmitter } from "events";
import { Server as WebSocketServer, IServerOptions } from "uws";

import { Protocol } from "./Protocol";
import { MatchMaker } from "./MatchMaker";
import { spliceOne } from "./Utils";
import { Room } from "./Room";
import { Client } from "./index";

import * as shortid from "shortid";
import * as msgpack from "msgpack-lite";

export type ServerOptions = IServerOptions & {
  ws?: WebSocketServer
};

export class Server extends EventEmitter {
  protected wss: WebSocketServer;
  protected matchMaker: MatchMaker = new MatchMaker();

  // room references by client id
  protected clients: {[id: string]: Room<any>[]} = {};

  constructor (options?: ServerOptions) {
    super();

    if (options) {
      this.attach(options);
    }
  }

  /**
   * Attaches Colyseus server to a server or port.
   */
  public attach (options: ServerOptions) {
    if (options.server || options.port) {
      this.wss = new WebSocketServer(options);

    } else {
      this.wss = options.ws;
    }

    this.wss.on('connection', this.onConnect);
  }

  /**
   * @example Registering with room name + class handler
   *    server.register("room_name", RoomHandler)
   *
   * @example Registering with room name + class handler + custom options
   *    server.register("area_1", AreaHandler, { map_file: "area1.json" })
   *    server.register("area_2", AreaHandler, { map_file: "area2.json" })
   *    server.register("area_3", AreaHandler, { map_file: "area3.json" })
   */
  public register (name: string, handler: Function, options?: any) {
    this.matchMaker.addHandler(name, handler, options);
  }

  private onConnect = (client: Client) => {
    let clientId = shortid.generate();

    client.id = clientId;
    client.send( msgpack.encode([ Protocol.USER_ID, clientId ]), { binary: true } );

    client.on('message', this.onMessage.bind(this, client));
    client.on('error', this.onError.bind(this, client));
    client.on('close', this.onDisconnect.bind(this, client));

    this.clients[ clientId ] = [];
    this.emit('connect', client);
  }

  private onError (client: Client, e: any) {
    console.error("[ERROR]", client.id, e);
  }

  private onMessage (client: Client, data: any) {
    let message;

    // try to decode message received from client
    try {
      message = msgpack.decode(Buffer.from(data));

    } catch (e) {
      console.error("Couldn't decode message:", data, e.stack);
      return;
    }

    this.emit('message', client, message);

    if (typeof(message[0]) === "number" && message[0] == Protocol.JOIN_ROOM) {
      this.onJoinRoomRequest(client, message[1], message[2], (err: string, room: Room<any>) => {
        if (err) {
          let roomId = (room) ? room.roomId : message[1];
          client.send(msgpack.encode([Protocol.JOIN_ERROR, roomId, err]), { binary: true });
          if (room) { (<any>room)._onLeave(client); }
        }
      });

    } else if (typeof(message[0]) === "number" && message[0] == Protocol.LEAVE_ROOM) {
      // trigger onLeave directly to specific room
      let room = this.matchMaker.getRoomById( message[1] );
      if (room) { (<any>room)._onLeave(client); }

    } else if (typeof(message[0]) === "number" && message[0] == Protocol.ROOM_DATA) {
      // send message directly to specific room
      let room = this.matchMaker.getRoomById( message[1] );
      if (room) { room.onMessage(client, message[2]); }

    } else {
      this.clients[ client.id ].forEach(room => room.onMessage(client, message));
    }
  }

  private onJoinRoomRequest ( client: Client, roomToJoin: number | string, clientOptions: any, callback: (err: string, room: Room<any>) => any): void {
    var room: Room<any>;
    let err: string;

    if (typeof(roomToJoin)==="string") {
      // room = this.matchMaker.joinOrCreateByName(client, roomToJoin, clientOptions || {});

    } else {
      // room = this.matchMaker.joinById(client, roomToJoin, clientOptions);
    }

    if ( room ) {
      try {
        (<any>room)._onJoin(client, clientOptions);

      } catch (e) {
        console.error(room.roomName, "onJoin:", e.stack);
        err = e.message;
      }

      room.once('leave', this.onClientLeaveRoom.bind(this, room));
      this.clients[ client.id ].push( room );

    } else {
      err = "join_request_fail";
    }

    callback(err, room);
  }

  private onClientLeaveRoom = (room: Room<any>, client: Client, isDisconnect: boolean): boolean => {
    if (isDisconnect) {
      return true;
    }

    var roomIndex = this.clients[ client.id ].indexOf(room);
    if (roomIndex >= 0) {
      spliceOne(this.clients[ client.id ], roomIndex);
    }
  }

  private onDisconnect (client) {
    this.emit('disconnect', client);

    // send leave message to all connected rooms
    this.clients[ client.id ].forEach(room => (<any>room)._onLeave(client, true));

    delete this.clients[ client.id ];
  }

}
