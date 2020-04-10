import Clock, { Delayed } from '@gamestdio/timer';

// Core classes
export { Server } from './Server';
export { Room, RoomInternalState } from './Room';
export { Protocol, ErrorCode } from './Protocol';
export { RegisteredHandler, SortOptions } from './matchmaker/RegisteredHandler';
export { ServerError } from './errors/ServerError';

// MatchMaker
import * as matchMaker from './MatchMaker';
export { matchMaker };

// Transport
export { Client } from './transport/Transport';

// Presence
export { Presence } from './presence/Presence';
export { LocalPresence } from './presence/LocalPresence';
export { RedisPresence } from './presence/RedisPresence';

// Default rooms
export { RelayRoom } from './rooms/RelayRoom';

// Serializers
export { FossilDeltaSerializer } from './serializer/FossilDeltaSerializer';
export { SchemaSerializer } from './serializer/SchemaSerializer';

// Utilities
export { Clock, Delayed };
export { nonenumerable as nosync } from 'nonenumerable'; // TODO: remove me on 1.0.0 (FossilDelta stuff)
export { generateId, Deferred } from './Utils';
