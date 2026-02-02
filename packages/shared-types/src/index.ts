import type { StandardSchemaV1 } from '@standard-schema/spec';

// Re-export StandardSchemaV1 for convenience
export type { StandardSchemaV1 };

// Re-export Protocol types
export { Protocol, ErrorCode, CloseCode } from './Protocol.js';

/**
 * Minimal Room-like interface for SDK type inference.
 * Allows typing SDK methods without depending on @colyseus/core.
 * Note: onJoin is optional because core Room defines it as optional.
 */
export interface ServerRoomLike<State = any, Options = any> {
  state: State;
  onJoin?: (client: any, options?: Options, auth?: any) => any;
  messages?: Record<string, any>;
  '~client'?: { '~messages'?: Record<string, any> };
}

/**
 * Seat reservation returned by matchmaking operations.
 */
export interface ISeatReservation {
  name: string;
  sessionId: string;
  roomId: string;
  publicAddress?: string;
  processId?: string;
  reconnectionToken?: string;
  devMode?: boolean;
}

/**
 * Extract instance type from a constructor type.
 * If T is not a constructor, returns T as-is.
 */
type Instantiate<T> = T extends abstract new (...args: any) => infer I ? I : T;

/**
 * Check if a type is a Schema (has ~refId marker).
 * Schema defines ~refId as optional, so we check keyof instead of property presence.
 */
type IsSchema<T> = '~refId' extends keyof T ? true : false;

/**
 * Check if ~state phantom property contains a useful type (not object/any/never).
 * Returns true if ~state exists and has meaningful structure.
 */
type HasUsefulStatePhantom<T> = T extends { '~state': infer S }
    ? [S] extends [never] ? false           // never is not useful
    : unknown extends S ? false             // any is not useful
    : S extends object
        ? [keyof S] extends [never] ? false // {} or object with no keys is not useful
        : true
        : false
    : false;

/**
 * Extract state from a Room-like instance type.
 * Priority: useful ~state phantom > Schema state property > return T as-is
 */
type ExtractStateFromRoom<T> = T extends { '~state': infer S }
    ? HasUsefulStatePhantom<T> extends true
        ? S  // Use ~state if it's useful
        : T extends { state: infer St }
            ? IsSchema<St> extends true ? St : T  // Fallback to state if Schema
            : T
    : T extends { state: infer S }
        ? IsSchema<S> extends true ? S : T
        : T;

/**
 * Infer the state type from T, or use explicit S if provided.
 *
 * Supports multiple usage patterns:
 * - Room<MyState>: T is a Schema type, return as-is
 * - Room<MyRoom>: T is a Room instance, extract from ~state or state property
 * - Room<typeof MyRoom>: T is a constructor, instantiate first then extract
 * - Room<T, ExplicitState>: S overrides all inference
 */
export type InferState<T, S> = [S] extends [never]
    ? Instantiate<T> extends infer I
        ? IsSchema<I> extends true
            ? I  // It's a Schema, return as-is
            : ExtractStateFromRoom<I>
        : never
    : S;

/**
 * Normalizes T for message extraction: returns T if it has ~state (Room type),
 * otherwise returns any (plain state type). This ensures Room<State> is equivalent
 * to Room<any, State> when State doesn't have ~state.
 */
export type NormalizeRoomType<T> = Instantiate<T> extends { '~state': any } ? T : any;

/**
 * Extract room messages type from a Room constructor or instance type.
 * Supports both constructor types (typeof MyRoom) and instance types (MyRoom)
 */
export type ExtractRoomMessages<T> = Instantiate<T> extends { messages: infer M } ? M : {};

/**
 * Extract client-side messages type from a Room constructor or instance type.
 * These are messages that the server can send to the client.
 */
export type ExtractRoomClientMessages<T> = Instantiate<T> extends { '~client': { '~messages': infer M } } ? M : {};

/**
 * Message handler with automatic type inference from format schema.
 * When a format is provided, the message type is automatically inferred from the schema.
 *
 * @template T - The StandardSchema type for message validation
 * @template Client - The client type (from @colyseus/core Transport)
 * @template This - The Room class context
 */
export type MessageHandlerWithFormat<T extends StandardSchemaV1 = any, Client = any, This = any> = {
  format: T;
  handler: (this: This, client: Client, message: StandardSchemaV1.InferOutput<T>) => void;
};

/**
 * Message handler type that can be either a function or a format handler with validation.
 *
 * @template Client - The client type (from @colyseus/core Transport)
 * @template This - The Room class context
 */
export type MessageHandler<Client = any, This = any> =
  | ((this: This, client: Client, message: any) => void)
  | MessageHandlerWithFormat<any, Client, This>;

/**
 * Extract the message payload type from a message handler.
 * Works with both function handlers and format handlers.
 */
export type ExtractMessageType<T> =
  T extends { format: infer Format extends StandardSchemaV1; handler: any }
    ? StandardSchemaV1.InferOutput<Format>
    : T extends (this: any, client: any, message: infer Message) => void
      ? Message
      : any;

/**
 * Fallback message handler that receives the message type as an additional parameter.
 * Used for "_" or "*" catch-all handlers.
 *
 * @template Client - The client type
 * @template This - The Room class context
 */
export type FallbackMessageHandler<Client = any, This = any> =
  (this: This, client: Client, type: string, message: any) => void;

/**
 * Message handler type including fallback handlers.
 * Used internally to allow "_" and "*" fallback handlers in the Messages type.
 * @internal
 */
export type AnyMessageHandler<Client = any, This = any> =
  | MessageHandler<Client, This>
  | FallbackMessageHandler<Client, This>;

/**
 * A map of message types to message handlers.
 * Supports special "_" and "*" keys for fallback/catch-all handlers.
 *
 * @template Room - The Room class type
 * @template Client - The client type
 */
export type Messages<Room = any, Client = any> = Record<string, AnyMessageHandler<Client, Room>> & ThisType<Room>;

/**
 * Exposed types for the client-side SDK.
 * Used by defineServer() to expose room and route types to the client.
 *
 * @template RoomTypes - Record of room names to their RegisteredHandler types
 * @template Routes - Router type from @colyseus/better-call
 */
export interface SDKTypes<
  RoomTypes extends Record<string, any> = any,
  Routes = any
> {
  '~rooms': RoomTypes;
  '~routes': Routes;
}
