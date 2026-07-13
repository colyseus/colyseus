/**
 * Geometry primitives for the overlay's inline-styled surfaces.
 *
 * A leaf, like `layout.ts`: it imports nothing from the overlay, so `core.ts`,
 * `panel.ts`, `predict.ts` and `modal.ts` can all anchor boxes the same way without
 * an import cycle. That is why the edge helpers take the position string rather than
 * reaching into `preferences` themselves.
 *
 * Two browser quirks are absorbed here so no caller has to remember them:
 *
 * - **Safe-area insets.** `env()` resolves to 0 unless the host page opted into
 *   `viewport-fit=cover`, so `max(base, env(...))` is a no-op on ordinary pages and
 *   only grows under a notch.
 * - **`dvh`.** Mobile browsers count the collapsible URL bar inside `vh`, so a "90vh"
 *   box overflows the visible area. `dvh` fixes it where supported.
 *
 * Both use the same trick: write the plain value first, then the enhanced one. The
 * CSSOM setter silently drops a value it cannot parse, so an engine without
 * `max()`/`env()`/`dvh` keeps the fallback instead of losing the property entirely.
 */

/** Distance from the viewport corner to the logo, and to anything anchored beside it. */
export const EDGE_INSET = 14;

export type VerticalEdge = 'top' | 'bottom';
export type HorizontalEdge = 'left' | 'right';
export type Edge = VerticalEdge | HorizontalEdge;

/** Which horizontal/vertical edge a `panelPosition` preference names. */
export function verticalEdge(position: string): VerticalEdge {
    return position.indexOf('top') === 0 ? 'top' : 'bottom';
}

export function horizontalEdge(position: string): HorizontalEdge {
    return position.indexOf('right') !== -1 ? 'right' : 'left';
}

/** Anchor `el`'s `side` at `base + extra` pixels, growing under a notch. */
export function setInset(el: HTMLElement, side: Edge, base: number, extra: number = 0) {
    el.style[side] = (base + extra) + 'px';
    const safe = `max(${base}px, env(safe-area-inset-${side}, 0px))`;
    el.style[side] = extra ? `calc(${safe} + ${extra}px)` : safe;
}

/** Release every edge so a box can be re-anchored without inheriting the old corner. */
export function clearEdges(el: HTMLElement) {
    el.style.top = 'auto';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.left = 'auto';
}

/** Cap a box against the viewport, preferring `dvh` over the URL-bar-inclusive `vh`. */
export function setMaxViewportHeight(el: HTMLElement, vhExpression: string) {
    el.style.maxHeight = vhExpression;
    el.style.maxHeight = vhExpression.replace(/vh\b/g, 'dvh');
}
