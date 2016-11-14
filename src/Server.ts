"use strict";

import { EventEmitter } from "events";
import { Server as WebSocketServer } from "ws";
// import { Server as WebSocketServer } from "uws";

import { Protocol } from "./Protocol";
import { MatchMaker } from "./MatchMaker";
import { spliceOne } from "./Utils";
import { Room } from "./Room";
import { Client } from "./index";

import * as shortid from "shortid";
import * as msgpack from "msgpack-lite";

// // memory debugging
// setInterval(function() { console.log(require('util').inspect(process.memoryUsage())); }, 1000)

export class Server extends EventEmitter {
  protected server: WebSocketServer;
  protected matchMaker: MatchMaker = new MatchMaker();

  // room references by client id
  protected clients: {[id: string]: Room<any>[]} = {};

  constructor (options) {
    super()

    this.server = new WebSocketServer(options)
    this.server.on('connection', this.onConnect)
  }

  /**
   * @example Registering with a class reference
   *    server.register(RoomHandler)
   *
   * @example Registering with room name + class handler
   *    server.register("room_name", RoomHandler)
   *
   * @example Registering with room name + class handler + custom options
   *    server.register("area_1", AreaHandler, { map_file: "area1.json" })
   *    server.register("area_2", AreaHandler, { map_file: "area2.json" })
   *    server.register("area_3", AreaHandler, { map_file: "area3.json" })
   */
  register (name: string, handler: Function, options?: any) {
    this.matchMaker.addHandler(name, handler, options)
  }

  onConnect = (client: Client) => {
    let clientId = shortid.generate();

    client.id = clientId;
    client.send( msgpack.encode([ Protocol.USER_ID, clientId ]), { binary: true } )

    client.on('message', this.onMessage.bind(this, client));
    client.on('error', this.onError.bind(this, client));
    client.on('close', this.onDisconnect.bind(this, client));

    this.clients[ clientId ] = [];
    this.emit('connect', client)
  }

  onError (client: Client, e: any) {
    console.error("[ERROR]", client.id, e)
  }

  onMessage (client: Client, data: any) {
    let message = msgpack.decode(data)
    this.emit('message', client, message)

    if (typeof(message[0]) === "number" && message[0] == Protocol.JOIN_ROOM) {
      try {
        this.onJoinRoomRequest(client, message[1], message[2])
      } catch (e) {
        console.error(e.stack)
        client.send(msgpack.encode([Protocol.JOIN_ERROR, message[1], e.message]), { binary: true })
      }

    } else if (typeof(message[0]) === "number" && message[0] == Protocol.LEAVE_ROOM) {
      // trigger onLeave directly to specific room
      let room = this.matchMaker.getRoomById( message[1] );
      if (room) room._onLeave(client)

    } else if (typeof(message[0]) === "number" && message[0] == Protocol.ROOM_DATA) {
      // send message directly to specific room
      let room = this.matchMaker.getRoomById( message[1] );
      if (room) room._onMessage(client, message[2])

    } else {
      this.clients[ client.id ].forEach(room => room._onMessage(client, message))
    }
  }

  onJoinRoomRequest (client: Client, roomToJoin: number | string, clientOptions: any) {
    var room: Room<any>;

    if (typeof(roomToJoin)==="string") {
      room = this.matchMaker.joinOrCreateByName(client, roomToJoin, clientOptions || {});

    } else {
      room = this.matchMaker.joinById(client, roomToJoin, clientOptions)
    }

    if ( room ) {
      room.on('leave', this.onClientLeaveRoom.bind(this, room))
      this.clients[ client.id ].push( room )

    } else {
      throw new Error("join_request_fail")
    }
  }

  onClientLeaveRoom (room, client, isDisconnect) {
    if (isDisconnect) {
      return true
    }

    var roomIndex = this.clients[ client.id ].indexOf(room)
    if (roomIndex >= 0) {
      spliceOne(this.clients[ client.id ], roomIndex)
    }
  }

  onDisconnect (client) {
    this.emit('disconnect', client)

    // send leave message to all connected rooms
    this.clients[ client.id ].forEach(room => room._onLeave(client, true))

    delete this.clients[ client.id ]
  }

}
