/**
 * Debug channel — the order-independent handshake between the SDK core and the
 * optional `@colyseus/sdk/debug` overlay.
 *
 * Publishers (a joined room in {@link Client}, a `Predict` instance) call
 * {@link publishDebug} whenever there's something the overlay could surface. If
 * the overlay is already loaded it renders immediately; if it loads LATER — the
 * usual dev-only `import("@colyseus/sdk/debug")` races the first room join —
 * {@link setDebugReceiver} REPLAYS what was buffered. No app-side ordering
 * (awaiting the import) is required, and a publisher that fires before the
 * overlay loads is never dropped.
 *
 * Module-private on purpose: rooms are reachable only by importing the overlay.
 * Nothing here may read or write a global — a page script could then read a
 * buffered room, or plant its own receiver and be handed every join.
 *
 * Production (overlay never imported) stays effectively free: the buffer holds
 * WeakRefs so nothing is pinned, and is bounded — an app that never loads the
 * overlay leaks neither memory nor room references.
 *
 * The script-tag builds share no module graph, so rollup swaps this file for
 * `debug-channel.umd.ts` there.
 */

export type DebugReceiver = (channel: string, handle: object) => void;

interface WeakRefLike { deref(): object | undefined; }

// Old embedded runtimes (some Cocos/Construct targets) lack WeakRef; fall back to
// a strong ref there — still bounded, so the worst case is a few pinned handles in
// a debug-less session, never an unbounded leak.
const makeRef: (h: object) => WeakRefLike =
    typeof WeakRef !== "undefined" ? (h) => new WeakRef(h) : (h) => ({ deref: () => h });

// A handful of rooms/Predict handles is plenty of replay depth; the bound keeps a
// debug-less prod session from growing the buffer without limit.
const MAX_BUFFERED = 64;

const buffer: Array<[string, WeakRefLike]> = [];
let receiver: DebugReceiver | undefined;

/**
 * Publish a `handle` to the overlay `channel` (`"room"` | `"predict"` | …).
 * Prod fast path: a live call (overlay loaded) or a bounded WeakRef append
 * (buffered for replay on install).
 */
export function publishDebug(channel: string, handle: object): void {
    if (receiver) {
        receiver(channel, handle);
        return;
    }
    buffer.push([channel, makeRef(handle)]);
    if (buffer.length > MAX_BUFFERED) { buffer.shift(); }
}

/**
 * Connect the overlay and replay everything buffered before it loaded. `undefined`
 * disconnects it again.
 */
export function setDebugReceiver(next: DebugReceiver | undefined): void {
    receiver = next;
    if (!next) { return; }
    for (const [channel, ref] of buffer.splice(0)) {
        const handle = ref.deref();
        if (handle) { next(channel, handle); }
    }
}

/**
 * True only when the overlay is connected. Diagnostics that must stay free in
 * production (reconciler drift bookkeeping) gate on this.
 */
export function debugOverlayActive(): boolean {
    return receiver !== undefined;
}
