/**
 * Viewport signals for the debug overlay.
 *
 * Two ORTHOGONAL signals, deliberately kept apart:
 *
 * - `compact` drives **layout** — which shape a surface takes (logo-anchored drawer
 *   vs corner dropdown, full-screen modal vs floating one). Narrow OR short viewport.
 * - `coarse` drives **hit targets** — how big a tappable thing must be. True on
 *   any touch device, including large tablets.
 *
 * They cross: a tablet is coarse-but-not-compact (desktop layout, big targets);
 * a narrow desktop window is compact-but-not-coarse (mobile layout, normal
 * targets). Collapsing them into one "isMobile" boolean gets both cases wrong.
 *
 * This module imports nothing from the overlay — keep it a leaf so `core.ts`,
 * `panel.ts` and `predict.ts` can all depend on it without cycles.
 */

export type LayoutState = {
    compact: boolean;
    coarse: boolean;
};

// Narrow OR short. Catches every phone in both orientations (portrait 390w hits
// the width query; landscape 844x390 hits the height query) while leaving
// tablets (>=744 portrait, >=768 landscape height) on the desktop layout.
const COMPACT_QUERY = "(max-width: 640px), (max-height: 480px)";

const COARSE_QUERY = "(pointer: coarse)";

let compactQuery: MediaQueryList | null = null;
let coarseQuery: MediaQueryList | null = null;

let state: LayoutState = { compact: false, coarse: false };

const listeners = new Set<(state: LayoutState) => void>();

let pending = false;

function read(): LayoutState {
    return {
        compact: !!compactQuery && compactQuery.matches,
        coarse: !!coarseQuery && coarseQuery.matches,
    };
}

// Rotation fires resize + orientationchange + two matchMedia changes back to back,
// so coalesce the burst into a single relayout. rAF does that whenever frames are
// being produced; the timeout is a safety net for when they are not (hidden tab,
// occluded window, headless). Whichever fires first wins — `pending` makes `run`
// idempotent, so a frame that never arrives cannot wedge the bus.
function schedule(): void {
    if (pending) { return; }
    pending = true;
    const run = function() {
        if (!pending) { return; }
        pending = false;
        state = read();
        reflow();
    };
    if (typeof requestAnimationFrame === "function") { requestAnimationFrame(run); }
    setTimeout(run, 50);
}

/** Re-run every subscriber. Call directly after changing a preference that affects layout. */
export function reflow(): void {
    listeners.forEach(function(fn) { fn(state); });
}

/** Subscribe to viewport/layout changes. Returns an unsubscribe function. */
export function onReflow(fn: (state: LayoutState) => void): () => void {
    listeners.add(fn);
    return function() { listeners.delete(fn); };
}

/** True when the viewport is narrow or short — the overlay switches shape. */
export function isCompact(): boolean { return state.compact; }

/** True on touch/stylus input — hit targets grow to 44px. Independent of {@link isCompact}. */
export function isCoarsePointer(): boolean { return state.coarse; }

/** Install the one listener set that drives every relayout. Idempotent. */
export function initLayout(): void {
    if (compactQuery || typeof window === "undefined" || !window.matchMedia) { return; }

    compactQuery = window.matchMedia(COMPACT_QUERY);
    coarseQuery = window.matchMedia(COARSE_QUERY);
    state = read();

    // matchMedia fires only on breakpoint crossings; resize covers in-breakpoint
    // changes (mobile URL bar collapsing, desktop window drag, split view).
    compactQuery.addEventListener("change", schedule);
    coarseQuery.addEventListener("change", schedule);
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("orientationchange", schedule, { passive: true });
}
