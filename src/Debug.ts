import * as debug from 'debug';

export const debugMatchMaking = debug('colyseus:matchmaking');
export const debugPatch = debug('colyseus:patch');
export const debugError = debug('colyseus:errors');

export const debugAndPrintError = (...args: any[]) => {
    console.error(...args);
    debugError.apply(debugError, args);
};
