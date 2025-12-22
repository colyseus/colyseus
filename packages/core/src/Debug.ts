import debug from 'debug';
import { logger } from './Logger.ts';
import { ServerError } from './errors/ServerError.ts';

export const debugConnection = debug('colyseus:connection');
debugConnection.log = console.debug.bind(console); // STDOUT

export const debugDriver = debug('colyseus:driver');
debugDriver.log = console.debug.bind(console); // STDOUT

export const debugMatchMaking = debug('colyseus:matchmaking');
debugMatchMaking.log = console.debug.bind(console); // STDOUT

export const debugMessage = debug('colyseus:message');
debugMessage.log = console.debug.bind(console); // STDOUT

export const debugPatch = debug('colyseus:patch');
debugPatch.log = console.debug.bind(console); // STDOUT

export const debugPresence = debug('colyseus:presence');
debugPresence.log = console.debug.bind(console); // STDOUT

export const debugError = debug('colyseus:errors');
debugError.log = console.error.bind(console); // STDERR

export const debugDevMode = debug('colyseus:devmode');
debugDevMode.log = console.debug.bind(console); // STDOUT

export const debugAndPrintError = (e: Error | string) => {
  const message = (e instanceof Error) ? e.stack : e;

  if (!(e instanceof ServerError)) {
    logger.error(message);
  }

  debugError.call(debugError, message);
};
