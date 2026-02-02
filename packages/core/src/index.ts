import { ClockTimer as Clock, Delayed } from '@colyseus/timer';

// Shared types - re-export from @colyseus/shared-types for convenience
export {
  Protocol,
  ErrorCode,
  CloseCode,
  type InferState,
  type ExtractRoomMessages,
  type ExtractRoomClientMessages,
} from '@colyseus/shared-types';

// Core classes
export { Server, defineRoom, defineServer, type ServerOptions, type SDKTypes } from './Server.ts';
export { Room, room, RoomInternalState, validate, type RoomOptions, type MessageHandlerWithFormat, type Messages, type ExtractRoomState, type ExtractRoomMetadata, type ExtractRoomClient } from './Room.ts';
export { getMessageBytes } from './Protocol.ts';
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
export { type Client, type ClientPrivate, type AuthContext, ClientState, ClientArray, Transport, type ISendOptions, connectClientToRoom } from './Transport.ts';

// Presence
export { type Presence } from './presence/Presence.ts';
export { LocalPresence } from './presence/LocalPresence.ts';

// Serializers
export { type Serializer } from './serializer/Serializer.ts';
export { SchemaSerializer } from './serializer/SchemaSerializer.ts';

// Utilities
export { Clock, Delayed };
export { generateId, Deferred, spliceOne, getBearerToken, dynamicImport } from './utils/Utils.ts';
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
export { QueueRoom, type QueueOptions, type QueueMatchGroup, type QueueMatchTeam, type QueueClientData } from './rooms/QueueRoom.ts';

// Router / Endpoints
export {
  createEndpoint,
  createInternalContext,
  createMiddleware,
  createRouter,
  toNodeHandler,
  __globalEndpoints,
  type Router,
  type RouterConfig,
  type Endpoint,
  type EndpointHandler,
  type EndpointOptions,
  type EndpointContext,
  type StrictEndpoint,
} from './router/index.ts';

// Abstract logging support
export { logger } from './Logger.ts';
