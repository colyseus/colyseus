import { ErrorCode } from '@colyseus/shared-types';

export class ServerError extends Error {
  public code: number;

  constructor(code: number = ErrorCode.MATCHMAKE_UNHANDLED, message?: string) {
    super(message);

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ServerError);
    }

    this.name = 'ServerError';
    this.code = code;
  }
}
