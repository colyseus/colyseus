import Clock, { Delayed } from '@colyseus/timer';

// Core classes
export { Server, type ServerOptions, type SDKTypes, defineRoom, defineServer } from './Server.ts';
export { Room, room, RoomInternalState, validate, type RoomOptions, type MessageHandlerWithFormat, type ExtractMessageType, type Messages, type ExtractRoomState, type ExtractRoomMetadata, type ExtractRoomClient } from './Room.ts';
export { Protocol, ErrorCode, getMessageBytes, CloseCode } from './Protocol.ts';
export { RegisteredHandler } from './matchmaker/RegisteredHandler.ts';
export { ServerError } from './errors/ServerError.ts';

export {
  type RoomException,
  type RoomMethodName,
  OnCreateException,
  OnAuthException,
  OnJoinException,
  OnLeaveException,
  OnDisposeException,
  OnMessageException,
  SimulationIntervalException,
  TimedEventException,
} from './errors/RoomExceptions.ts';

// MatchMaker
import * as matchMaker from './MatchMaker.ts';
export { matchMaker };
export { updateLobby, subscribeLobby } from './matchmaker/Lobby.ts';

// Driver
export * from './matchmaker/LocalDriver/LocalDriver.ts';
export { initializeRoomCache } from './matchmaker/driver.ts';

// Transport
export { type Client, type ClientPrivate, type AuthContext, ClientState, ClientArray, Transport, type ISendOptions } from './Transport.ts';

// Presence
export { type Presence } from './presence/Presence.ts';
export { LocalPresence } from './presence/LocalPresence.ts';

// Serializers
export { type Serializer } from './serializer/Serializer.ts';
export { SchemaSerializer } from './serializer/SchemaSerializer.ts';
// export { SchemaSerializerDebug } from './serializer/SchemaSerializerDebug.ts';

// Utilities
export { Clock, Delayed };
export { generateId, Deferred, HttpServerMock, spliceOne, getBearerToken } from './utils/Utils.ts';
export { isDevMode } from './utils/DevMode.ts';

// IPC
export { subscribeIPC, requestFromIPC } from './IPC.ts';

// Debug
export {
  debugMatchMaking,
  debugMessage,
  debugPatch,
  debugError,
  debugConnection,
  debugDriver,
  debugPresence,
  debugAndPrintError,
} from './Debug.ts';

// Default rooms
export { LobbyRoom } from './rooms/LobbyRoom.ts';
export { RelayRoom } from './rooms/RelayRoom.ts';
export { RankedQueueRoom, type RankedQueueOptions, type MatchGroup, type MatchTeam, type ClientQueueData } from './rooms/RankedQueueRoom.ts';

// Router / Endpoints
export {
  createEndpoint,
  createInternalContext,
  createMiddleware,
  createRouter,
  toNodeHandler,
  type Router,
} from './router/index.ts';

// Abstract logging support
export { logger } from './Logger.ts';
