import debug from 'debug';
import { ServerError } from './errors/ServerError';
import { logger } from './Logger';

export const debugConnection = debug('colyseus:connection');
export const debugDriver = debug('colyseus:driver');
export const debugError = debug('colyseus:errors');
export const debugMatchMaking = debug('colyseus:matchmaking');
export const debugMessage = debug('colyseus:message');
export const debugPatch = debug('colyseus:patch');
export const debugPresence = debug('colyseus:presence');

export const debugAndPrintError = (e: Error | string) => {
  const message = (e instanceof Error) ? e.stack : e;

  if (!(e instanceof ServerError)) {
    logger.error(message);
  }

  debugError.call(debugError, message);
};
