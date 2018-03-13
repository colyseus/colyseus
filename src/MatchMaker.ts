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

const REMOTE_REQUEST_JOIN_TIMEOUT = 400;

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

  public bindClient (client: Client, roomId: string) {
    let roomPromise = this.onJoin(roomId, client);

    // register 'close' event early on. the client might disconnect before
    // successfully joining the requested room
    client.on('close', (_) => this.onLeave(client, roomId));

    roomPromise.then(room => {
      client.on('message', (message) => {
        if (!(message = decode(message))) {
          return;
        }
        this.execute(client, message);
      });

    }).catch(err => {
      console.log("CATCH:", typeof(err), err);
      send(client, [Protocol.JOIN_ERROR, roomId, err]);

      client.removeAllListeners();
    });

    return roomPromise;
  }

  protected execute (client: Client, message: any) {
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
  public async onJoinRoomRequest (roomToJoin: string, clientOptions: ClientOptions, allowCreateRoom: boolean = true): Promise<Room> {
    // let room: Room;
    let room: any;
    let err: string;

    clientOptions.sessionId = generateId();

    console.log("hasHandler?", roomToJoin, this.hasHandler(roomToJoin));
    console.log("allowCreateRoom", allowCreateRoom);

    if (this.hasHandler(roomToJoin)) {
      let bestRoomByScore = await this.getAvailableRoomByScore(roomToJoin, clientOptions);
      let roomId = bestRoomByScore && bestRoomByScore.roomId;

      room = (roomId && this.localRooms.getById(roomId))
        || (allowCreateRoom && this.create(roomToJoin, clientOptions));

    } else if (isValidId(roomToJoin)) {
      room = this.joinById(roomToJoin, clientOptions);
    }

    console.log("ROOM:", typeof(room));

    if (room) {
      // Reserve a seat for clientId
      room.connectingClients[clientOptions.clientId] = clientOptions;

    } else {
      console.log("throw error!");
      throw new Error("join_request_fail");
    }

    return room;
  }

  /**
   * Binds target client to the room running in a worker process.
   */
  public onJoin (roomId: string, client: Client): Promise<Room> {
    const room = this.localRooms.getById(roomId);
    const clientOptions = room && room.connectingClients[ client.id ];

    return new Promise<Room>((resolve, reject) => {
      if (room && clientOptions) {
        // assign sessionId to socket connection.
        client.sessionId = clientOptions.sessionId;

        // clean temporary data
        delete clientOptions.sessionId;
        delete clientOptions.clientId;

        let isVerified = room.verifyClient(client, clientOptions);

        if (!(isVerified instanceof Promise)) {
          isVerified = (isVerified)
            ? Promise.resolve()
            : Promise.reject(undefined);
        }

        const onVerifyFailure = (err?: string) => {
          err = err || "verifyClient failed.";

          debugMatchMaking(`JOIN_ERROR: ${err} (roomId: %s, clientOptions: %j)`, roomId, clientOptions);

          (<any>room)._disposeIfEmpty();

          reject(err);
        }

        isVerified.then((result) => {
          //
          // promise returned falsy value
          //
          if (result === false) { return onVerifyFailure(); }

          //
          // client may have disconnected before 'verifyClient' is complete
          //
          if (client.readyState !== WebSocket.OPEN) {
            return reject("client already disconnected");
          }

          (<any>room)._onJoin(client, clientOptions);
          room.once('leave', this.onClientLeaveRoom.bind(this, room));

          this.sessions[ client.sessionId ] = room;

          // emit 'join' on registered handler
          this.handlers[room.roomName].emit("join", room, client);

          resolve(room);

        }).catch(onVerifyFailure).then(() => {
          // clean reserved seat only after verifyClient succeeds
          delete room.connectingClients[client.id];
        });

      } else {
        let err =  "trying to join non-existing room";

        debugMatchMaking(`JOIN_ERROR: ${ err } (roomId: %s, clientOptions: %j)`, roomId, clientOptions);

        reject(err);
      }
    });
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
    let roomsWithScore = (await this.getRoomsWithScore(roomName, clientOptions)).
      sort((a, b) => b.score - a.score);;

    console.log("rooms with score:", roomsWithScore);

    return roomsWithScore[0];
  }

  protected async getRoomsWithScore (roomName: string, clientOptions: ClientOptions): Promise<RoomWithScore[]> {
    let roomsWithScore: RoomWithScore[] = [];
    let roomIds = await this.presence.smembers(roomName);
    let remoteRequestJoins = [];

    roomIds.forEach(roomId => {
      if (!this.localRooms.getById(roomId)) {
        let requestId = generateId();
        let requestJoinSubscription = `${roomId}:${requestId}`;

        remoteRequestJoins.push(new Promise((resolve, reject) => {
          const unsubscribe = () => {
            this.presence.unsubscribe(requestJoinSubscription);
            return true;
          }

          this.presence.subscribe(requestJoinSubscription, (score) => {
            resolve({ roomId, score });
            unsubscribe();
          });

          this.presence.publish(roomId, ['requestJoin', requestId, clientOptions]);

          setTimeout(() => unsubscribe() && reject(), REMOTE_REQUEST_JOIN_TIMEOUT);
        }));

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
        let [ method, requestId, args ] = message;

        if (method === "requestJoin") {
          this.presence.publish(`${room.roomId}:${requestId}`, room.requestJoin.call(room, args[0], false));
        }

        console.log(`REDIS: ${room.roomId}, messsage: ${message}`)
      });

      // this.presence.registerRoom(roomName, room.roomId, process.pid);

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