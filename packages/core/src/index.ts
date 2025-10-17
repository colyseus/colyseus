import Clock, { Delayed } from '@colyseus/timer';

// Core classes
export { Server, type ServerOptions, defineRoom, defineServer } from './Server.ts';
export { Room, RoomInternalState } from './Room.ts';
export { Protocol, ErrorCode, getMessageBytes } from './Protocol.ts';
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
export * from './matchmaker/driver/local/LocalDriver.ts';

// Transport
export { type Client, type DefineClient, type ClientPrivate, type AuthContext, ClientState, ClientArray, Transport, type ISendOptions } from './Transport.ts';

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

// Router / Endpoints
export { createEndpoint, createInternalContext, createMiddleware, createRouter, toNodeHandler } from './router/index.ts';

// Abstract logging support
export { logger } from './Logger.ts';
