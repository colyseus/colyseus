import Clock, { Delayed } from '@colyseus/timer';

// Core classes
export { Server, type ServerOptions } from './Server.js';
export { Room, RoomInternalState } from './Room.js';
export { Protocol, ErrorCode, getMessageBytes } from './Protocol.js';
export { RegisteredHandler } from './matchmaker/RegisteredHandler.js';
export { ServerError } from './errors/ServerError.js';

export {
  type RoomException,
  OnCreateException,
  OnAuthException,
  OnJoinException,
  OnLeaveException,
  OnDisposeException,
  OnMessageException,
  SimulationIntervalException,
  TimedEventException,
} from './errors/RoomExceptions.js';

// MatchMaker
import * as matchMaker from './MatchMaker.js';
export { matchMaker };
export { updateLobby, subscribeLobby } from './matchmaker/Lobby.js';

// Driver
export * from './matchmaker/driver/local/LocalDriver.js';

// Transport
export { type Client, type ClientPrivate, type AuthContext, ClientState, ClientArray, Transport, type ISendOptions } from './Transport.js';

// Presence
export { type Presence } from './presence/Presence.js';
export { LocalPresence } from './presence/LocalPresence.js';

// Serializers
export { type Serializer } from './serializer/Serializer.js';
export { SchemaSerializer } from './serializer/SchemaSerializer.js';
// export { SchemaSerializerDebug } from './serializer/SchemaSerializerDebug.js';

// Utilities
export { Clock, Delayed };
export { generateId, Deferred, HttpServerMock, spliceOne, getBearerToken } from './utils/Utils.js';
export { isDevMode } from './utils/DevMode.js';

// IPC
export { subscribeIPC, requestFromIPC } from './IPC.js';

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
} from './Debug.js';

// Default rooms
export { LobbyRoom } from './rooms/LobbyRoom.js';
export { RelayRoom } from './rooms/RelayRoom.js';

// Abstract logging support
export { logger } from './Logger.js';
