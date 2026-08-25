/**
 * Debug channel — the order-independent handshake between the SDK core and the
 * optional `@colyseus/sdk/debug` overlay.
 *
 * Publishers (a joined room in {@link Client}, a `Predict` instance) call
 * {@link publishDebug} whenever there's something the overlay could surface. If
 * the overlay is already loaded it renders immediately; if it loads LATER — the
 * usual dev-only `import("@colyseus/sdk/debug")` races the first room join — a
 * lightweight buffering stub captures the publishes so the overlay REPLAYS them
 * on install. No app-side ordering (awaiting the import) is required, and a
 * publisher that fires before the overlay loads is never dropped.
 *
 * Production (overlay never imported) stays effectively free: the stub is created
 * only on first publish, holds WeakRefs so nothing is pinned, and is bounded — an
 * app that never loads the overlay leaks neither memory nor room references.
 */

/** The receiver `@colyseus/sdk/debug` installs on `globalThis.__colyseusDebug`. */
export interface ColyseusDebugRegistry {
    publish(channel: string, handle: object): void;
}

interface WeakRefLike { deref(): object | undefined; }

// The pre-load buffer stub carries `__buffer`; the overlay's live receiver does
// NOT. That absence is the discriminator {@link debugOverlayActive} keys on — a
// buffered-but-unwatched publish must not read as a live overlay (else prod-only
// diagnostics like reconciler drift bookkeeping would switch on without one).
interface BufferStub extends ColyseusDebugRegistry {
    readonly __buffer: Array<[string, WeakRefLike]>;
}

type DebugGlobal = { __colyseusDebug?: ColyseusDebugRegistry & Partial<BufferStub> };

// Old embedded runtimes (some Cocos/Construct targets) lack WeakRef; fall back to
// a strong ref there — still bounded, so the worst case is a few pinned handles in
// a debug-less session, never an unbounded leak.
const makeRef: (h: object) => WeakRefLike =
    typeof WeakRef !== "undefined" ? (h) => new WeakRef(h) : (h) => ({ deref: () => h });

// A handful of rooms/Predict handles is plenty of replay depth; the bound keeps a
// debug-less prod session from growing the buffer without limit.
const MAX_BUFFERED = 64;

/**
 * Publish a `handle` to the overlay `channel` (`"room"` | `"predict"` | …).
 * Prod fast path: one property read, then either a live `publish` (overlay
 * loaded) or a bounded WeakRef append (buffered for replay on install).
 */
export function publishDebug(channel: string, handle: object): void {
    const g = globalThis as DebugGlobal;
    let reg = g.__colyseusDebug;
    if (!reg) {
        const buffer: Array<[string, WeakRefLike]> = [];
        reg = g.__colyseusDebug = {
            __buffer: buffer,
            publish(ch: string, h: object) {
                buffer.push([ch, makeRef(h)]);
                if (buffer.length > MAX_BUFFERED) { buffer.shift(); }
            },
        };
    }
    reg.publish(channel, handle);
}

/**
 * True only when the overlay installed its LIVE receiver — NOT when
 * {@link publishDebug} merely created the pre-load buffer. Diagnostics that must
 * stay free in production (reconciler drift bookkeeping) gate on this.
 */
export function debugOverlayActive(): boolean {
    if (typeof globalThis === "undefined") { return false; }
    const reg = (globalThis as DebugGlobal).__colyseusDebug;
    return reg != null && reg.__buffer === undefined;
}
