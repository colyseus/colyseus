import type { DebugReceiver } from "./debug-channel.ts";

/**
 * Debug channel for the script-tag builds, which rollup substitutes for
 * `debug-channel.ts`. `dist/colyseus.js` and `dist/debug.js` share no module
 * graph, so a global `dist/debug.js` installs is their only link.
 *
 * Without `dist/debug.js` there's no global, and publishes go nowhere. A pre-load
 * buffer can't exist here: anything `dist/debug.js` could drain, any page script
 * could read. So `dist/debug.js` has to load before the first join.
 */
type DebugGlobal = { __colyseusDebug?: DebugReceiver };

export function publishDebug(channel: string, handle: object): void {
    (globalThis as DebugGlobal).__colyseusDebug?.(channel, handle);
}

export function setDebugReceiver(receiver: DebugReceiver): void {
    (globalThis as DebugGlobal).__colyseusDebug = receiver;
}

export function debugOverlayActive(): boolean {
    return (globalThis as DebugGlobal).__colyseusDebug !== undefined;
}
