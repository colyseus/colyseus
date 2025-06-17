import type { Client } from '../Transport.js';
import type { Room } from '../Room.js';

export type RoomMethodName = 'onCreate'
  | 'onAuth'
  | 'onJoin'
  | 'onLeave'
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
  OnDisposeException |
  OnMessageException<R> |
  SimulationIntervalException |
  TimedEventException;

export class OnCreateException<R extends Room = Room> extends Error {
  constructor(
    cause: Error,
    message: string,
    public options: Parameters<R['onCreate']>[0],
  ) {
    super(message, { cause });
    this.name = 'OnCreateException';
  }
}

export class OnAuthException<R extends Room = Room> extends Error {
  constructor(
    cause: Error,
    message: string,
    public client: Parameters<R['onAuth']>[0],
    public options: Parameters<R['onAuth']>[1],
  ) {
    super(message, { cause });
    this.name = 'OnAuthException';
  }
}

export class OnJoinException<R extends Room = Room> extends Error {
  constructor(
    cause: Error,
    message: string,
    public client: Parameters<R['onJoin']>[0],
    public options: Parameters<R['onJoin']>[1],
    public auth: Parameters<R['onJoin']>[2],
  ) {
    super(message, { cause });
    this.name = 'OnJoinException';
  }
}

export class OnLeaveException<R extends Room = Room> extends Error {
  constructor(
    cause: Error,
    message: string,
    public client: Parameters<R['onLeave']>[0],
    public consented: Parameters<R['onLeave']>[1],
  ) {
    super(message, { cause });
    this.name = 'OnLeaveException';
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
  constructor(
    cause: Error,
    message: string,
    public client: R['~client'],
    public payload: Parameters<R['messages'][MessageType]>[1],
    public type: MessageType,
  ) {
    super(message, { cause });
    this.name = 'OnMessageException';
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