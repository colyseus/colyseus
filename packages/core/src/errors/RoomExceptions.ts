import type { Client } from '../Transport.js';
import type { ExtractAuthData, ExtractUserData, Room } from '../Room.js';

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

export class OnMessageException<R extends Room = Room, MessagePayload = any> extends Error {
  constructor(
    cause: Error,
    message: string,
    public client: Client<ExtractUserData<R['clients']>, ExtractAuthData<R['clients']>>,
    public payload: MessagePayload,
    public type: string,
  ) {
    super(message, { cause });
    this.name = 'OnMessageException';
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