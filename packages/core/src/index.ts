import { ClockTimer as Clock, Delayed } from '@colyseus/timer';

// Shared types - re-export from @colyseus/shared-types for convenience
export {
  Protocol,
  ProtocolModifier,
  ErrorCode,
  CloseCode,
  ResponseStatus,
  type InferState,
  type ExtractRoomMessages,
  type ExtractRoomClientMessages,
  type MessageContext,
  type Rejection,
  type Resolution,
  type ExtractRejectReason,
  type ExtractResponseType,
} from '@colyseus/shared-types';

// Core classes
export { Server, defineRoom, defineServer, registerRoomDefinitions, unregisterRoomDefinitions, type RoomDefinitions, type ServerOptions, type SDKTypes } from './Server.ts';
export { Room, RoomInternalState, validate, type RoomOptions, type DefineInputOptions, type SimulationCallback, type FixedTimestepCallback, type StepContext, type MessageHandlerWithFormat, type Messages, type ExtractRoomState, type ExtractRoomMetadata, type ExtractRoomClient } from './Room.ts';
export { InputBufferImpl, compileSanitizer } from './input/InputBuffer.ts';
export { type InputAccessor, type InputAPI, type NormalizedInputOptions, type ConsumeOptions, type IdleInput, type IdleContext, type SanitizeInput, type NumericFieldsOf } from './input/types.ts';
export { Rewind, RewindView, type RewindOptions, type RewindMode } from './Rewind.ts';
export {
  RoomPlugin, definePlugins, attachToTestRoom,
  type RoomPluginOrder, type PluginDependencies, type RoomPluginClass,
} from './RoomPlugin.ts';
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
  TimestepException,
  SimulationIntervalException,
  TimedEventException,
} from './errors/RoomExceptions.ts';

// MatchMaker
import * as matchMaker from './MatchMaker.ts';
export { matchMaker };
export { updateLobby, subscribeLobby } from './matchmaker/Lobby.ts';
export { createNodeMatchmakingMiddleware } from './router/node.ts';

// Driver
export * from './matchmaker/LocalDriver/LocalDriver.ts';
export { initializeRoomCache } from './matchmaker/driver.ts';

// Transport
export { type Client, type ClientPrivate, type AuthContext, ClientState, ClientArray, Transport, type ISendOptions, type BeforeUpgradeHandler, runBeforeUpgrade, createAuthContext, connectClientToRoom, enqueueClientRaw } from './Transport.ts';

// Presence
export { type Presence } from './presence/Presence.ts';
export { LocalPresence } from './presence/LocalPresence.ts';

// Serializers
export { type Serializer } from './serializer/Serializer.ts';
export { SchemaSerializer } from './serializer/SchemaSerializer.ts';

// Utilities
export { Clock, Delayed };
export { generateId, Deferred, spliceOne, getBearerToken, dynamicImport } from './utils/Utils.ts';
export { isDevMode, setDevMode } from './utils/DevMode.ts';

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
  basicAuth,
  type BasicAuthOptions,
  toNodeHandler,
  dualModeEndpoints,
  type Router,
  type RouterConfig,
  type Endpoint,
  type EndpointHandler,
  type EndpointOptions,
  type EndpointContext,
  type StrictEndpoint,
  type ExpressMiddleware,
  type NodeHandler,
  type DualModeHelpers,
} from './router/index.ts';

// Abstract logging support
export { logger } from './Logger.ts';
