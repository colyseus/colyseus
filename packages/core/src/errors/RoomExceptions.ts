import type { ExtractMessageType } from '@colyseus/shared-types';
import type { Room } from '../Room.ts';

export type RoomMethodName = 'onCreate'
  | 'onAuth'
  | 'onJoin'
  | 'onLeave'
  | 'onDrop'
  | 'onReconnect'
  | 'onDispose'
  | 'onMessage'
  | 'setSimulationInterval'
  | 'setInterval'
  | 'setTimeout';

export type RoomException<R extends Room = Room> =
  OnCreateException<R> |
  OnAuthException<R> |
  OnJoinException<R> |
  OnLeaveException<R> |
  OnDropException<R> |
  OnReconnectException<R> |
  OnDisposeException |
  OnMessageException<R> |
  SimulationIntervalException |
  TimedEventException;

export class OnCreateException<R extends Room = Room> extends Error {
  options: Parameters<R['onCreate']>[0];
  constructor(
    cause: Error,
    message: string,
    options:  Parameters<R['onCreate']>[0],
  ) {
    super(message, { cause });
    this.name = 'OnCreateException';
    this.options = options;
  }
}

export class OnAuthException<R extends Room = Room> extends Error {
  client: Parameters<R['onAuth']>[0];
  options: Parameters<R['onAuth']>[1];
  constructor(
    cause: Error,
    message: string,
    client: Parameters<R['onAuth']>[0],
    options: Parameters<R['onAuth']>[1],
  ) {
    super(message, { cause });
    this.name = 'OnAuthException';
    this.client = client;
    this.options = options;
  }
}

export class OnJoinException<R extends Room = Room> extends Error {
  client: Parameters<R['onJoin']>[0];
  options: Parameters<R['onJoin']>[1];
  auth: Parameters<R['onJoin']>[2];
  constructor(
    cause: Error,
    message: string,
    client: Parameters<R['onJoin']>[0],
    options: Parameters<R['onJoin']>[1],
    auth: Parameters<R['onJoin']>[2],
  ) {
    super(message, { cause });
    this.name = 'OnJoinException';
    this.client = client;
    this.options = options;
    this.auth = auth;
  }
}

export class OnLeaveException<R extends Room = Room> extends Error {
  client: Parameters<R['onLeave']>[0];
  consented: Parameters<R['onLeave']>[1];
  constructor(
    cause: Error,
    message: string,
    client: Parameters<R['onLeave']>[0],
    consented: Parameters<R['onLeave']>[1],
  ) {
    super(message, { cause });
    this.name = 'OnLeaveException';
    this.client = client;
    this.consented = consented;
  }
}

export class OnDropException<R extends Room = Room> extends Error {
  client: Parameters<R['onDrop']>[0];
  code: Parameters<R['onDrop']>[1];
  constructor(
    cause: Error,
    message: string,
    client: Parameters<R['onDrop']>[0],
    code: Parameters<R['onDrop']>[1],
  ) {
    super(message, { cause });
    this.name = 'OnDropException';
    this.client = client;
    this.code = code;
  }
}

export class OnReconnectException<R extends Room = Room> extends Error {
  client: Parameters<R['onReconnect']>[0];
  constructor(
    cause: Error,
    message: string,
    client: Parameters<R['onReconnect']>[0],
  ) {
    super(message, { cause });
    this.name = 'OnReconnectException';
    this.client = client;
  }
}

export class OnDisposeException extends Error {
  constructor(
    cause: Error,
    message: string,
  ) {
    super(message, { cause });
    this.name = 'OnDisposeException';
  }
}

export class OnMessageException<R extends Room, MessageType extends keyof R['messages'] = keyof R['messages']> extends Error {
  client: R['~client'];
  payload: ExtractMessageType<R['messages'][MessageType]>;
  type: MessageType;
  constructor(
    cause: Error,
    message: string,
    client: R['~client'],
    payload: ExtractMessageType<R['messages'][MessageType]>,
    type: MessageType,
  ) {
    super(message, { cause });
    this.name = 'OnMessageException';
    this.client = client;
    this.payload = payload;
    this.type = type;
  }

  public isType<T extends keyof R['messages']>(type: T): this is OnMessageException<R, T> {
    return (this.type as string) === type;
  }
}

export class SimulationIntervalException extends Error {
  constructor(
    cause: Error,
    message: string,
  ) {
    super(message, { cause });
    this.name = 'SimulationIntervalException';
  }
}

export class TimedEventException extends Error {
  public args: any[];
  constructor(
    cause: Error,
    message: string,
    ...args: any[]
  ) {
    super(message, { cause });
    this.name = 'TimedEventException';
    this.args = args;
  }
}