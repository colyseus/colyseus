/**
 * This file contains only relevant parts of Cocos Creator to build colyseus.js
 * For full Cocos Creator definition file, see: https://github.com/toddlxt/Creator-TypeScript-Boilerplate/blob/master/creator.d.ts
 */

declare module cc {
    export let sys: Isys;

    export interface Isys {
        /** cc.sys.localStorage is a local storage component. */
        localStorage: Storage;

        /** Is native ? This is set to be true in jsb auto. */
        isNative: boolean;
    }
}
