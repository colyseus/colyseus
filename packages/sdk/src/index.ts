import './legacy';

export { ColyseusSDK, Client, type JoinOptions, type EndpointSettings, type ClientOptions, type ISeatReservation as SeatReservation } from './Client.ts';
export { Room, type RoomAvailable } from './Room.ts';
export { Auth, type AuthSettings, type PopupSettings, type AuthResponse, type UserDataResponse, type ForgotPasswordResponse, type AuthData } from "./Auth.ts";
export { ServerError, AbortError, MatchMakeError } from './errors/Errors.ts';
export { CloseCode, ErrorCode, Protocol } from '@colyseus/shared-types'; // convenience re-export / backwards compatibility
export type { InferRoomConstructor } from './core/utils.ts';

/*
 * Serializers
 */
import { SchemaSerializer, getStateCallbacks } from "./serializer/SchemaSerializer.ts";
import { NoneSerializer } from "./serializer/NoneSerializer.ts";
import { registerSerializer } from './serializer/Serializer.ts';
export { Callbacks } from "@colyseus/schema";

export { registerSerializer, SchemaSerializer, getStateCallbacks };
registerSerializer('schema', SchemaSerializer);
registerSerializer('none', NoneSerializer);
