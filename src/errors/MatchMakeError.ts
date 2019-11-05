import { Protocol } from '../Protocol';

export class MatchMakeError extends Error {
  public code: number;
  constructor(message: string, code: number = Protocol.ERR_MATCHMAKE_UNHANDLED) {
    super(message);
    this.code = code;
  }
}
