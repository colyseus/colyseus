import './legacy';

export { Client, JoinOptions, MatchMakeError, type EndpointSettings, type ClientOptions } from './Client';
export { Protocol, ErrorCode, SeatReservation } from './Protocol';
export { Room, RoomAvailable } from './Room';
export { Auth, type AuthSettings, type PopupSettings } from "./Auth";
export { ServerError } from './errors/Errors';

/*
 * Serializers
 */
import { SchemaSerializer, getStateCallbacks } from "./serializer/SchemaSerializer";
import { NoneSerializer } from "./serializer/NoneSerializer";
import { registerSerializer } from './serializer/Serializer';

export { registerSerializer, SchemaSerializer, getStateCallbacks };
registerSerializer('schema', SchemaSerializer);
registerSerializer('none', NoneSerializer);
