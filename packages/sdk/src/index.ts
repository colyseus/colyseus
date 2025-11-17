import './legacy';

export { ColyseusSDK, Client, JoinOptions, MatchMakeError, type EndpointSettings, type ClientOptions } from './Client.ts';
export { Protocol, ErrorCode, SeatReservation } from './Protocol.ts';
export { Room, RoomAvailable } from './Room.ts';
export { Auth, type AuthSettings, type PopupSettings } from "./Auth.ts";
export { ServerError, CloseCode } from './errors/Errors.ts';

/*
 * Serializers
 */
import { SchemaSerializer, getStateCallbacks } from "./serializer/SchemaSerializer.ts";
import { NoneSerializer } from "./serializer/NoneSerializer.ts";
import { registerSerializer } from './serializer/Serializer.ts';

export { registerSerializer, SchemaSerializer, getStateCallbacks };
registerSerializer('schema', SchemaSerializer);
registerSerializer('none', NoneSerializer);
