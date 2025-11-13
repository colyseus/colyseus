export enum CloseCode {
    NORMAL_CLOSURE = 1000,
    GOING_AWAY = 1001,
    NO_STATUS_RECEIVED = 1005,
    ABNORMAL_CLOSURE = 1006,

    CONSENTED = 4000,
    DEVMODE_RESTART = 4010
}

export class ServerError extends Error {
  public code: number;

  constructor(code: number, message: string) {
    super(message);

    this.name = "ServerError";
    this.code = code;
  }
}

export class AbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbortError";
  }
}
