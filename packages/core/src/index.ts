import Clock, { Delayed } from '@gamestdio/timer';

// Core classes
export { Server, type ServerOptions } from './Server';
export { Room, RoomInternalState } from './Room';
export { Protocol, ErrorCode, getMessageBytes } from './Protocol';
export { RegisteredHandler } from './matchmaker/RegisteredHandler';
export { ServerError } from './errors/ServerError';

// MatchMaker
import * as matchMaker from './MatchMaker';
export { matchMaker };
export { updateLobby, subscribeLobby } from './matchmaker/Lobby';

// Driver
export * from './matchmaker/driver';

// Transport
export { type Client, ClientState, ClientArray, Transport, type ISendOptions } from './Transport';

// Presence
export { type Presence } from './presence/Presence';
export { LocalPresence } from './presence/LocalPresence';

// Serializers
export { type Serializer } from './serializer/Serializer';
export { SchemaSerializer } from './serializer/SchemaSerializer';

// Utilities
export { Clock, Delayed };
export { generateId, Deferred, DummyServer, spliceOne } from './utils/Utils';
export { isDevMode } from './utils/DevMode';

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
} from './Debug';

// Default rooms
export { LobbyRoom } from './rooms/LobbyRoom';
export { RelayRoom } from './rooms/RelayRoom';

// Abstract logging support
export { logger } from './Logger'
