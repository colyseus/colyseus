import { Server, Room, matchMaker, type SDKTypes } from "@colyseus/core";
import { ColyseusSDK, type Room as SDKRoom } from "@colyseus/sdk";
import * as httpie from "httpie";

/**
 * Infer the room constructor from ServerType based on the instance type.
 * This allows proper type inference for SDK Room methods like `send()` and `onMessage()`.
 */
type InferRoomConstructor<ServerType extends SDKTypes, Instance> =
  // First, try to find a matching room constructor in ServerType['~rooms']
  ServerType extends SDKTypes<infer Rooms>
    ? {
        [K in keyof Rooms]: Instance extends InstanceType<Rooms[K]['~room']>
          ? Rooms[K]['~room']
          : never
      }[keyof Rooms]
    : // Fallback: create a synthetic constructor type from the instance
      (typeof Room) & { prototype: Instance };


export class ColyseusTestServer<ServerType extends SDKTypes = any> {
  public server: Server;
  public sdk: ColyseusSDK<ServerType>;

  //
  // TODO: deprecate this on Colyseus 1.0.
  // Use `sdk.http` instead (which uses the auth token automatically)
  //
  public http: {
    get: typeof httpie.get,
    post: typeof httpie.post,
    patch: typeof httpie.patch,
    delete: typeof httpie.del,
    put: typeof httpie.put,
  };

  constructor(server: Server) {
    this.server = server;

    const hostname = "127.0.0.1";
    const port = server['port'];
    this.sdk = new ColyseusSDK<ServerType>(`ws://${hostname}:${port}`);

    const httpEndpoint = `http://${hostname}:${port}`;
    this.http = {
      ['get']: (segments, opts) => httpie.get(`${httpEndpoint}${segments}`, opts),
      ['post']: (segments, opts) => httpie.post(`${httpEndpoint}${segments}`, opts),
      ['patch']: (segments, opts) => httpie.patch(`${httpEndpoint}${segments}`, opts),
      ['delete']: (segments, opts) => httpie.del(`${httpEndpoint}${segments}`, opts),
      ['put']: (segments, opts) => httpie.put(`${httpEndpoint}${segments}`, opts),
    };
  }

  // Overload: Use room name from ServerType to infer room type
  async createRoom<R extends keyof ServerType['~rooms']>(
    roomName: R,
    clientOptions?: Parameters<ServerType['~rooms'][R]['~room']['prototype']['onJoin']>[1]
  ): Promise<InstanceType<ServerType['~rooms'][R]['~room']>>;
  // Overload: Pass Room type directly
  async createRoom<R extends Room>(
    roomName: string,
    clientOptions?: any
  ): Promise<R>;
  // Overload: Pass State and Metadata type directly
  async createRoom<State extends object = any, Metadata = any>( // TODO: deprecate on v1.0
    roomName: string,
    clientOptions?: any
  ): Promise<Room<{ state: State, metadata: Metadata }>>;
  // Implementation
  async createRoom(roomName: string, clientOptions: any = {}) {
    const room = await matchMaker.createRoom(roomName, clientOptions);
    return this.getRoomById(room.roomId);
  }

  connectTo<RoomInstance extends Room>(
    room: RoomInstance,
    clientOptions: any = {},
  ): Promise<SDKRoom<InferRoomConstructor<ServerType, RoomInstance>>> {
    return this.sdk.joinById<InferRoomConstructor<ServerType, RoomInstance>>(room.roomId, clientOptions);
  }

  // Overload: Pass Room type directly
  getRoomById<T extends Room>(roomId: string): T;
  // Overload: Pass State and Metadata type directly
  getRoomById<State extends object = any, Metadata = any>(roomId: string): Room<{ state: State, metadata: Metadata }>;
  // Implementation
  getRoomById(roomId: string) {
    return matchMaker.getLocalRoomById(roomId);
  }

  async cleanup() {
    // ensure no rooms are still alive
    await Promise.all(matchMaker.disconnectAll());
    await this.sdk.auth.signOut();

    const driver = this.server['driver'];
    if (driver) { driver.clear(); }
  }

  async shutdown() {
    await this.server.gracefullyShutdown(false);
  }

}
