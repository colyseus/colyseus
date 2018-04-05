import * as debug from 'debug';

export const debugMatchMaking = debug('colyseus:matchmaking');
export const debugPatch = debug('colyseus:patch');
export const debugPatchData = debug('colyseus:patch:data');

const debugErrors = debug('colyseus:errors');
export const debugError = (...args: any[]) => {
    console.error(...args);
    debugErrors.apply(debugError, args);
};
