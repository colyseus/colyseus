import { merge } from './Utils';

import { Client, generateId, isValidId } from './index';
import { IpcProtocol, Protocol } from './Protocol';

import { RegisteredHandler } from './matchmaker/RegisteredHandler';
import { Room, RoomAvailable, RoomConstructor } from './Room';

import { LocalPresence } from './presence/LocalPresence';
import { Presence } from './presence/Presence';

import { debugAndPrintError, debugMatchMaking } from './Debug';
import { MatchMakeError } from './Errors';
import { RoomCache, RoomCacheData } from './matchmaker/RoomCache';

export type ClientOptions = any;

export interface RoomWithScore {
  roomId: string;
  score: number;
}

// remote room call timeouts
export const REMOTE_ROOM_SHORT_TIMEOUT = Number(process.env.COLYSEUS_PRESENCE_SHORT_TIMEOUT || 4000);

type RemoteRoomResponse<T= any> = [string?, T?];

export class MatchMaker {
  public handlers: {[id: string]: RegisteredHandler} = {};
  public exposedMethods = ['joinOrCreate', 'create', 'join', 'joinById'];

  private processId: string;
  private localRooms: {[roomId: string]: Room} = {};
  private presence: Presence;

  private isGracefullyShuttingDown: boolean = false;

  constructor(presence?: Presence, processId?: string) {
    this.presence = presence || new LocalPresence();
    this.processId = processId;
  }

  public async joinOrCreate(roomName: string, options: ClientOptions) {
    // Object.keys(handler.options)
    let room = await this.queryRoom(roomName, options);

    if (!room) {
      room = await this.createRoom(roomName, options);
    }

    return this.reserveSeatFor(room, options);
  }

  public async create(roomName: string, options: ClientOptions) {
    const handler = this.handlers[roomName];
    if (!handler) {
      throw new MatchMakeError(`no available handler for "${roomName}"`, Protocol.ERR_MATCHMAKE_NO_HANDLER);
    }

    // Object.keys(handler.options)
    const room = await this.createRoom(roomName, options);

    return this.reserveSeatFor(room, options);
  }

  public async join(roomName: string, options: ClientOptions) {
    const room = await this.queryRoom(roomName, options);

    if (!room) {
      throw new MatchMakeError(`no rooms found with provided criteria`, Protocol.ERR_MATCHMAKE_INVALID_CRITERIA);
    }

    return this.reserveSeatFor(room, options);
  }

  public async joinById(roomId: string, options: ClientOptions) {
    const isValidRoomId = isValidId(roomId);
    const room = isValidRoomId && await RoomCache.findOne({ roomId }, { _id: 0, processId: 1, roomId: 1 });

    if (!room) {
      throw new MatchMakeError(`room ${roomId} not found`, Protocol.ERR_MATCHMAKE_INVALID_ROOM_ID);
    }

    return this.reserveSeatFor(room, options);
  }

  public async query(roomName?: string) {
    const conditions: any = { locked: false };

    if (roomName) {
      conditions.name = roomName;
    }

    return await RoomCache.find({
      locked: false,
      ...conditions,
    }, {
      _id: 0,
      clients: 1,
      locked: 1,
      maxClients: 1,
      metadata: 1,
      name: 1,
      roomId: 1,
    });
  }

  public async queryRoom(roomName: string, options: ClientOptions) {
    const handler = this.handlers[roomName];
    if (!handler) {
      throw new MatchMakeError(`no available handler for "${roomName}"`, Protocol.ERR_MATCHMAKE_NO_HANDLER);
    }

    const query = RoomCache.findOne({
      locked: false,
      name: roomName,
      ...handler.getFilterOptions(options),
    }, { _id: 0, processId: 1, roomId: 1 });

    if (handler.sortOptions) {
      query.sort(handler.sortOptions);
    }

    return await query;
  }

  public async remoteRoomCall<R= any>(
    roomId: string,
    method: string,
    args?: any[],
    rejectionTimeout = REMOTE_ROOM_SHORT_TIMEOUT,
  ): Promise<RemoteRoomResponse<R>> {
    const room = this.localRooms[roomId];

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
          const [code, data] = message;
          if (code === IpcProtocol.SUCCESS) {
            resolve(data);

          } else if (code === IpcProtocol.ERROR) {
            reject(data);
          }
          unsubscribe();
        });

        this.presence.publish(this.getRoomChannel(roomId), [method, requestId, args]);

        unsubscribeTimeout = setTimeout(() => {
          unsubscribe();

          const request = `${method}${ args && ' with args ' + JSON.stringify(args) || '' }`;
          reject(new Error(`remote room (${roomId}) timed out, requesting "${request}". ` +
            `Timeout setting: ${rejectionTimeout}ms`));
        }, rejectionTimeout);
      });

    } else {
      return [
        this.processId,
        (!args && typeof (room[method]) !== 'function')
          ? room[method]
          : (await room[method].apply(room, args)),
      ];
    }
  }

  public defineRoomType(name: string, klass: RoomConstructor, defaultOptions: any = {}) {
    const registeredHandler = new RegisteredHandler(klass, defaultOptions);

    this.handlers[name] = registeredHandler;

    this.cleanupStaleRooms(name);

    return registeredHandler;
  }

  public hasHandler(name: string) {
    return this.handlers[ name ] !== undefined;
  }

  public async createRoom(roomName: string, clientOptions: ClientOptions): Promise<RoomCacheData> {
    const registeredHandler = this.handlers[ roomName ];
    const room = new registeredHandler.klass();

    // set room public attributes
    room.roomId = generateId();
    room.roomName = roomName;
    room.presence = this.presence;

    if (room.onCreate) {
      await room.onCreate(merge({}, clientOptions, registeredHandler.options));
    }

    // imediatelly ask client to join the room
    debugMatchMaking('spawning \'%s\' (%s) on process %d', roomName, room.roomId, process.pid);

    room.on('lock', this.lockRoom.bind(this, roomName, room));
    room.on('unlock', this.unlockRoom.bind(this, roomName, room));
    room.on('join', this.onClientJoinRoom.bind(this, room));
    room.on('leave', this.onClientLeaveRoom.bind(this, room));
    room.once('dispose', this.disposeRoom.bind(this, roomName, room));

    // room always start unlocked
    await this.createRoomReferences(room, true);

    // create a RoomCache reference.
    room.cache = await RoomCache.create({
      maxClients: room.maxClients,
      name: roomName,
      processId: this.processId,
      roomId: room.roomId,
      ...registeredHandler.getFilterOptions(clientOptions),
    });

    registeredHandler.emit('create', room);

    return room.cache;
  }

  // used only for testing purposes
  public getRoomById(roomId: string) {
    return this.localRooms[roomId];
  }

  public gracefullyShutdown(): Promise<any> {
    if (this.isGracefullyShuttingDown) {
      return Promise.reject(false);
    }

    this.isGracefullyShuttingDown = true;

    const promises = [];

    for (const roomId in this.localRooms) {
      if (!this.localRooms.hasOwnProperty(roomId)) {
        continue;
      }

      const room = this.localRooms[roomId];
      promises.push( room.disconnect() );
    }

    return Promise.all(promises);
  }

  protected async reserveSeatFor(room: RoomCacheData, options) {
    const sessionId: string = generateId();

    await this.remoteRoomCall(room.roomId, '_reserveSeat', [{ sessionId }, options]);

    return { room, sessionId };
  }

  protected async cleanupStaleRooms(roomName: string) {
    //
    // clean-up possibly stale room ids
    // (ungraceful shutdowns using Redis can result on stale room ids still on memory.)
    //
    const cachedRooms = await RoomCache.find({ name: roomName });

    // remove connecting counts
    await this.presence.del(this.getHandlerConcurrencyKey(roomName));

    await Promise.all(cachedRooms.map(async (room) => {
      try {
        // use hardcoded short timeout for cleaning up stale rooms.
        await this.remoteRoomCall(room.roomId, 'roomId');

      } catch (e) {
        debugMatchMaking(`cleaning up stale room '${roomName}' (${room.roomId})`);
        room.remove();

        this.clearRoomReferences({ roomId: room.roomId, roomName } as Room);
        this.presence.srem(`a_${roomName}`, room.roomId);
      }
    }));
  }

  protected async createRoomReferences(room: Room, init: boolean = false): Promise<boolean> {
    this.localRooms[room.roomId] = room;

    // add unlocked room reference
    await this.presence.sadd(room.roomName, room.roomId);

    if (init) {
      // add alive room reference (a=all)
      await this.presence.sadd(`a_${room.roomName}`, room.roomId);

      await this.presence.subscribe(this.getRoomChannel(room.roomId), (message) => {
        const [method, requestId, args] = message;

        const reply = (code, data) => {
          this.presence.publish(`${room.roomId}:${requestId}`, [code, [this.processId, data]]);
        };

        // reply with property value
        if (!args && typeof (room[method]) !== 'function') {
          return reply(IpcProtocol.SUCCESS, room[method]);
        }

        // reply with method result
        let response: any;
        try {
          response = room[method].apply(room, args);

        } catch (e) {
          debugAndPrintError(e.stack || e);
          return reply(IpcProtocol.ERROR, e.message || e);
        }

        if (!(response instanceof Promise)) {
          return reply(IpcProtocol.SUCCESS, response);
        }

        response.
          then((result) => reply(IpcProtocol.SUCCESS, result)).
          catch((e) => {
            // user might have called `reject()` without arguments.
            const err = e && e.message || e;
            reply(IpcProtocol.ERROR, err);
          });
      });
    }

    return true;
  }

  protected clearRoomReferences(room: Room) {
    this.presence.srem(room.roomName, room.roomId);

    // clear list of connecting clients.
    this.presence.del(room.roomId);
  }

  protected async awaitRoomAvailable(roomToJoin: string) {
      const key = this.getHandlerConcurrencyKey(roomToJoin);
      const concurrency = await this.presence.incr(key) - 1;

      this.presence.decr(key);

      if (concurrency > 0) {
        // avoid having too long timeout if 10+ clients ask to join at the same time
        const concurrencyTimeout = Math.min(concurrency * 100, REMOTE_ROOM_SHORT_TIMEOUT);

        debugMatchMaking(
          'receiving %d concurrent requests for joining \'%s\' (waiting %d ms)',
          concurrency, roomToJoin, concurrencyTimeout,
        );

        return await new Promise((resolve, reject) => setTimeout(resolve, concurrencyTimeout));
      } else {
        return true;
      }
  }

  protected getRoomChannel(roomId: string) {
    return `$${roomId}`;
  }

  protected getHandlerConcurrencyKey(name: string) {
    return `${name}:c`;
  }

  private onClientJoinRoom(room: Room, client: Client) {
    this.handlers[room.roomName].emit('join', room, client);
  }

  private onClientLeaveRoom(room: Room, client: Client) {
    this.handlers[room.roomName].emit('leave', room, client);
  }

  private lockRoom(roomName: string, room: Room): void {
    this.clearRoomReferences(room);

    // emit public event on registered handler
    this.handlers[room.roomName].emit('lock', room);
  }

  private async unlockRoom(roomName: string, room: Room) {
    if (await this.createRoomReferences(room)) {

      // emit public event on registered handler
      this.handlers[room.roomName].emit('unlock', room);
    }
  }

  private disposeRoom(roomName: string, room: Room): void {
    debugMatchMaking('disposing \'%s\' (%s) on process %d', roomName, room.roomId, process.pid);

    // remove from room listing
    room.cache.remove();

    // remove all room listeners.
    room.removeAllListeners();

    // emit disposal on registered session handler
    this.handlers[roomName].emit('dispose', room);

    // remove from alive rooms
    this.presence.srem(`a_${roomName}`, room.roomId);

    // remove concurrency key
    this.presence.del(this.getHandlerConcurrencyKey(roomName));

    // remove from available rooms
    this.clearRoomReferences(room);

    // unsubscribe from remote connections
    this.presence.unsubscribe(this.getRoomChannel(room.roomId));

    // remove actual room reference
    delete this.localRooms[room.roomId];
  }

}
