import type { StandardSchemaV1 } from '@standard-schema/spec';

// Re-export StandardSchemaV1 for convenience
export type { StandardSchemaV1 };

/**
 * Minimal Room-like interface for SDK type inference.
 * Allows typing SDK methods without depending on @colyseus/core.
 */
export interface ServerRoomLike<State = any, Options = any> {
  state: State;
  onJoin: (client: any, options?: Options, auth?: any) => any;
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
 * Helper types for flexible Room generics on the client SDK.
 * Allows: Room<State>, Room<ServerRoom>, or Room<ServerRoom, State>
 */
export type InferState<T, S> = [S] extends [never]
    ? (T extends abstract new (...args: any) => { state: infer ST }
        ? ST  // Constructor type (typeof MyRoom): extract state from instance
        : T extends { state: infer ST }
            ? ST  // Instance type (MyRoom): extract state directly
            : T)  // State type or other: return as-is
    : S;

/**
 * Extract room messages type from a Room constructor or instance type.
 * Supports both constructor types (typeof MyRoom) and instance types (MyRoom)
 */
export type ExtractRoomMessages<T> = T extends abstract new (...args: any) => { messages: infer M }
    ? M
    : T extends { messages: infer M }
        ? M
        : {};

/**
 * Extract client-side messages type from a Room constructor or instance type.
 * These are messages that the server can send to the client.
 */
export type ExtractRoomClientMessages<T> = T extends abstract new (...args: any) => { '~client': { '~messages': infer M } }
    ? M
    : T extends { '~client': { '~messages': infer M } }
        ? M
        : {};

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
 * A map of message types to message handlers.
 *
 * @template Room - The Room class type
 * @template Client - The client type
 */
export type Messages<Room = any, Client = any> = Record<string, MessageHandler<Client, Room>>;

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
