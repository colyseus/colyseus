import { decode, $refId, type Iterator } from '@colyseus/schema';
import { unpack } from 'msgpackr';

import { CloseCode, ErrorCode, Protocol, ResponseStatus, type MessageContext } from '@colyseus/shared-types';
import { getMessageBytes } from './Protocol.ts';
import { createNanoEvents } from './utils/nanoevents.ts';
import { standardValidate, type StandardSchemaV1 } from './utils/StandardSchema.ts';
import { wrapTryCatch } from './utils/Utils.ts';
import { isDevMode } from './utils/DevMode.ts';
import { debugMessage, debugAndPrintError } from './Debug.ts';
import { OnMessageException } from './errors/RoomExceptions.ts';
import type { Client, ClientPrivate } from './Transport.ts';
import type { Room } from './Room.ts';

/** Normalize a thrown value into the `{ name, message, code? }` shape echoed in a
 *  ROOM_RESPONSE error reply. */
function toResponseError(e: any): { name: string; message: string; code?: any } {
  if (e instanceof Error) {
    const code = (e as any).code;
    return (code !== undefined)
      ? { name: e.name, message: e.message, code }
      : { name: e.name, message: e.message };
  }
  return { name: "Error", message: String(e) };
}

/** The refId the encoder assigned `entity`, or `undefined` if it isn't attached
 *  to the rooted state tree (so it has no wire identity to echo). `$refId` is the
 *  same global registered symbol the encoder stamps on every attached instance;
 *  schema shares it via the process-wide Symbol Registry (`Symbol.for`), so the
 *  import resolves to one identical value even across duplicate installs. */
function refIdOf(entity: any): number | undefined {
  return (entity == null) ? undefined : (entity as Record<symbol, number | undefined>)[$refId];
}

// The handler's terminal action — NOT the wire ResponseStatus: `none` and
// `resolved` both reply OK (return value vs the entity's `{ref}`), a distinction
// a single OK can't carry; ERROR is never a handler decision (thrown/no-handler).
// Projected onto ResponseStatus once, in onRequest's reply.
const OUTCOME_NONE = 0, OUTCOME_REJECTED = 1, OUTCOME_RESOLVED = 2;

/**
 * Runtime {@link MessageContext} for a {@link Protocol.ROOM_REQUEST} dispatch.
 * `reject`/`resolve` record the decision on the ctx; `onRequest` reads it after the
 * handler settles, so a bare side-effecting call works as well as `return
 * ctx.reject(r)` (the branded return is compile-time only — the runtime return is
 * unused).
 */
class DispatchContext implements MessageContext {
  readonly id: number | undefined;
  _outcome = OUTCOME_NONE;
  _reason: any = undefined;
  _entity: any = undefined;

  constructor(id: number | undefined) {
    this.id = id;
  }

  reject(reason?: any): any {
    this._outcome = OUTCOME_REJECTED;
    this._reason = reason;
    return undefined;
  }

  resolve(entity?: any): any {
    this._outcome = OUTCOME_RESOLVED;
    this._entity = entity;
    return undefined;
  }
}

/** Shared no-op context for fire-and-forget `ROOM_DATA` (no reply channel, so
 *  `reject`/`resolve` go nowhere). `id` is `undefined`; zero per-message allocation. */
const SEND_CONTEXT: MessageContext = Object.freeze({
  id: undefined,
  reject: () => undefined as any,
  resolve: () => undefined as any,
});

/**
 * Per-room message-routing layer, owned by {@link Room}. Owns the user-message
 * handler registry (`onMessage`/`onMessageBytes` + per-type validators) and
 * decodes/dispatches the user-message wire frames (ROOM_DATA / ROOM_REQUEST /
 * ROOM_DATA_BYTES). Room's `_onMessage` keeps the protocol/lifecycle frames
 * (JOIN/PING/LEAVE/input) and calls one of these per frame, preserving the
 * original dispatch order. Reads back into its Room only for `onUncaughtException`
 * (handler wrapping) and `roomId`/`roomName` (logging).
 *
 * @internal
 */
export class RoomMessages {
  private room: Room<any>;

  /** Handler registry (nanoevents). Public so Room can re-expose it as
   *  `onMessageEvents` for @colyseus/playground introspection and
   *  @colyseus/testing handler-swapping. */
  events = createNanoEvents();

  /** Per-type StandardSchema validators. Public for the same reason as
   *  {@link events} (`onMessageValidators`). */
  validators: { [type: string]: StandardSchemaV1 } = {};

  constructor(room: Room<any>) {
    this.room = room;
  }

  /**
   * Register a handler (body of {@link Room.onMessage}). Wraps the callback via
   * the room's `onUncaughtException` when set, stores the validator, and returns
   * the unbind closure.
   */
  on(
    _messageType: '*' | string | number,
    _validationSchema: StandardSchemaV1 | ((...args: any[]) => void),
    _callback?: (...args: any[]) => void,
  ): () => void {
    const messageType = _messageType.toString();

    const validationSchema = (typeof _callback === 'function')
      ? _validationSchema as StandardSchemaV1
      : undefined;

    const callback = (validationSchema === undefined)
      ? _validationSchema as (...args: any[]) => void
      : _callback;

    const removeListener = this.events.on(messageType, (this.room.onUncaughtException !== undefined)
      ? wrapTryCatch(callback, this.room.onUncaughtException.bind(this.room), OnMessageException, 'onMessage', false, _messageType)
      : callback);

    if (validationSchema !== undefined) {
      this.validators[messageType] = validationSchema;
    }

    // returns a method to unbind the callback
    return () => {
      removeListener();
      if (this.events.events[messageType].length === 0) {
        delete this.validators[messageType];
      }
    };
  }

  /** Dispatch a `ROOM_DATA` frame: decode type + msgpack payload, validate, emit. */
  onData(client: Client & ClientPrivate, buffer: Buffer, it: Iterator): void {
    const messageType = (decode.stringCheck(buffer, it))
      ? decode.string(buffer, it)
      : decode.number(buffer, it);

    let message;
    try {
      message = (buffer.byteLength > it.offset)
        ? unpack(buffer.subarray(it.offset, buffer.byteLength))
        : undefined;
      debugMessage("received: '%s' -> %j (roomId: %s)", messageType, message, this.room.roomId);

      // custom message validation
      if (this.validators[messageType] !== undefined) {
        message = standardValidate(this.validators[messageType], message);
      }

    } catch (e: any) {
      debugAndPrintError(e);
      client.leave(CloseCode.WITH_ERROR);
      return;
    }

    if (this.events.events[messageType]) {
      this.events.emit(messageType as string, client, message, SEND_CONTEXT);

    } else if (this.events.events['*']) {
      this.events.emit('*', client, messageType, message);

    } else {
      this.#noHandler(client, messageType, message);
    }
  }

  /** Dispatch a `ROOM_REQUEST` frame: same handlers as ROOM_DATA, but the client
   *  opted into a reply, so echo the `requestId` with the outcome. The handler's
   *  reply is decided by what it returns / does to `ctx`: `ctx.reject(reason)` →
   *  `REJECTED(reason)`, `ctx.resolve(entity)` → `OK { ref }` (entity's refId,
   *  resolved here at reply-send), a thrown error or missing handler → `ERROR`,
   *  else `OK(return)`. */
  onRequest(client: Client & ClientPrivate, buffer: Buffer, it: Iterator): void {
    const requestId = decode.number(buffer, it);

    const messageType = (decode.stringCheck(buffer, it))
      ? decode.string(buffer, it)
      : decode.number(buffer, it);

    let message;
    try {
      message = (buffer.byteLength > it.offset)
        ? unpack(buffer.subarray(it.offset, buffer.byteLength))
        : undefined;
      debugMessage("request #%d: '%s' -> %j (roomId: %s)", requestId, messageType, message, this.room.roomId);

      // custom message validation (shared with the ROOM_DATA path)
      if (this.validators[messageType] !== undefined) {
        message = standardValidate(this.validators[messageType], message);
      }

    } catch (e: any) {
      // Reply with an error so the caller's pending request settles instead of timing out.
      debugAndPrintError(e);
      this.#replyToRequest(client, requestId, ResponseStatus.ERROR, toResponseError(e));
      return;
    }

    // Answered by the FIRST handler registered for the type (emit would discard
    // returns); wildcard handlers have no response contract, so they're ineligible.
    const handler = this.events.events[messageType as string]?.[0];

    if (handler === undefined) {
      this.#replyToRequest(client, requestId, ResponseStatus.ERROR, {
        name: "no_handler",
        message: `room "${this.room.roomName}" has no onMessage("${messageType}") handler to answer this request.`,
      });
      return;
    }

    const ctx = new DispatchContext(requestId);

    // Sync handlers reply in this tick with no promise machinery; only a thenable
    // return defers to the microtask queue. A sync throw (unwrapped handler) and an
    // async rejection both fall to the ERROR reply. With onUncaughtException set the
    // handler is wrapped (swallows its own errors), so it never throws / its promise
    // resolves undefined, and the error reports there.
    let response: any;
    try {
      response = handler(client, message, ctx);
      if (response !== null && typeof response === 'object' && typeof response.then === 'function') {
        response.then(
          (resolved: any) => this.#settleRequest(client, requestId, ctx, resolved),
          (e: any) => {
            debugAndPrintError(e);
            this.#replyToRequest(client, requestId, ResponseStatus.ERROR, toResponseError(e));
          },
        );
        return;
      }
    } catch (e: any) {
      debugAndPrintError(e);
      this.#replyToRequest(client, requestId, ResponseStatus.ERROR, toResponseError(e));
      return;
    }

    this.#settleRequest(client, requestId, ctx, response);
  }

  /** Project a settled handler outcome onto a ROOM_RESPONSE reply: `ctx.reject` →
   *  REJECTED(reason), `ctx.resolve` → OK { ref } (refId resolved here), else OK(return). */
  #settleRequest(client: Client, requestId: number, ctx: DispatchContext, response: any): void {
    if (ctx._outcome === OUTCOME_REJECTED) {
      this.#replyToRequest(client, requestId, ResponseStatus.REJECTED, ctx._reason);
    } else if (ctx._outcome === OUTCOME_RESOLVED) {
      const ref = refIdOf(ctx._entity);
      this.#replyToRequest(client, requestId, ResponseStatus.OK, ref !== undefined ? { ref } : undefined);
    } else {
      this.#replyToRequest(client, requestId, ResponseStatus.OK, response);
    }
  }

  /** Dispatch a `ROOM_DATA_BYTES` frame: raw bytes routed to `_$b`-prefixed handlers. */
  onDataBytes(client: Client & ClientPrivate, buffer: Buffer, it: Iterator): void {
    const messageType = (decode.stringCheck(buffer, it))
      ? decode.string(buffer, it)
      : decode.number(buffer, it);

    let message: any = buffer.subarray(it.offset, buffer.byteLength);
    debugMessage("received: '%s' -> %j (roomId: %s)", messageType, message, this.room.roomId);

    const bytesMessageType = `_$b${messageType}`;

    // custom message validation
    try {
      if (this.validators[bytesMessageType] !== undefined) {
        message = standardValidate(this.validators[bytesMessageType], message);
      }
    } catch (e: any) {
      debugAndPrintError(e);
      client.leave(CloseCode.WITH_ERROR);
      return;
    }

    if (this.events.events[bytesMessageType]) {
      this.events.emit(bytesMessageType, client, message);

    } else if (this.events.events['*']) {
      this.events.emit('*', client, messageType, message);

    } else {
      this.#noHandler(client, messageType, message);
    }
  }

  #replyToRequest(client: Client, requestId: number, status: ResponseStatus, payload?: any): void {
    debugMessage("response #%d: status=%d -> %j (roomId: %s)", requestId, status, payload, this.room.roomId);
    client.enqueueRaw(getMessageBytes[Protocol.ROOM_RESPONSE](requestId, status, payload));
  }

  /** No handler for the type: error the client in dev, drop it in production. */
  #noHandler(client: Client, messageType: string | number, _message: unknown): void {
    const errorMessage = `room onMessage for "${messageType}" not registered.`;
    debugMessage(`${errorMessage} (roomId: ${this.room.roomId})`);
    if (isDevMode) {
      client.error(ErrorCode.INVALID_PAYLOAD, errorMessage);
    } else {
      client.leave(CloseCode.WITH_ERROR, errorMessage);
    }
  }
}
