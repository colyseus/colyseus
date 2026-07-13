/**
 * The overlay's one static stylesheet, injected into the shadow root.
 *
 * Scope discipline: **every rule targets a `.cds-*` class or an explicit
 * `#id::pseudo-element`.** A bare `button { … }` here would silently restyle every
 * inline-styled control in the overlay, since the shadow root is our whole world.
 *
 * Division of labour with the rest of the overlay: geometry (`top`/`left`/`width`)
 * stays in JS, because it depends on the panel-position preference and the compact
 * breakpoint — runtime state a media query cannot read, and inline values a
 * stylesheet cannot override without `!important`. What lives here is everything a
 * media query *can* own: pointer ergonomics, `touch-action`, scroll behaviour, and
 * the slider pseudo-elements that inline styles can never reach.
 */

let injected = false;

// Thumb sits centered on the track: (track - thumb) / 2.
const CSS = `
.cds-surface, .cds-surface * { touch-action: manipulation; }

/* The logo carries a long-press gesture; without this, holding it raises the
   selection callout / context menu instead. */
#debug-logo-container {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
}

/* Drag surfaces and sliders claim the gesture outright — otherwise a horizontal
   drag on the latency slider scrolls the menu instead of moving the thumb. */
[data-drag], .resize-handle, .cds-range { touch-action: none; }

.cds-scroll {
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
}
.cds-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.cds-scroll::-webkit-scrollbar-track { background: transparent; }
.cds-scroll::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
}

/* Network-simulation sliders. The gradient fill is re-injected per input event
   (see panel.ts); everything static lives here so a coarse-pointer override can
   win by source order instead of !important. Height lives here rather than
   inline for the same reason. */
.cds-range { height: 20px; }

#latency-slider::-webkit-slider-runnable-track,
#jitter-slider::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 3px;
    border: none;
}
#latency-slider::-moz-range-track,
#jitter-slider::-moz-range-track {
    height: 6px;
    border-radius: 3px;
    border: none;
}
#latency-slider::-webkit-slider-thumb,
#jitter-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    margin-top: -5px;
    border-radius: 50%;
    border: 2px solid #888;
    background: #fff;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    transition: transform 0.1s ease, box-shadow 0.1s ease;
}
#latency-slider::-webkit-slider-thumb:hover,
#jitter-slider::-webkit-slider-thumb:hover {
    transform: scale(1.1);
    box-shadow: 0 3px 6px rgba(0, 0, 0, 0.3);
}
#latency-slider::-moz-range-thumb,
#jitter-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid #888;
    background: #fff;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    transition: transform 0.1s ease;
}
#latency-slider::-moz-range-thumb:hover,
#jitter-slider::-moz-range-thumb:hover { transform: scale(1.1); }

@keyframes debug-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }

@media (pointer: coarse) {
    /* min-* composes with the inline width/height each control already carries —
       nothing inline sets min-*, so no specificity fight. */
    .cds-hit { min-width: 44px; min-height: 44px; }

    /* Height-only, for controls in a fixed-width row that can't afford 44px each
       (the five Predict mode pills would wrap out of a 240px card). */
    .cds-hit-y { min-height: 44px; }

    .cds-range { height: 32px; }

    #latency-slider::-webkit-slider-runnable-track,
    #jitter-slider::-webkit-slider-runnable-track { height: 10px; border-radius: 5px; }
    #latency-slider::-moz-range-track,
    #jitter-slider::-moz-range-track { height: 10px; border-radius: 5px; }

    #latency-slider::-webkit-slider-thumb,
    #jitter-slider::-webkit-slider-thumb {
        width: 24px;
        height: 24px;
        margin-top: -7px;
    }
    #latency-slider::-moz-range-thumb,
    #jitter-slider::-moz-range-thumb { width: 24px; height: 24px; }
}
`;

/** Inject the base sheet once. Called from `getDebugRoot()`. */
export function injectBaseStyles(root: ShadowRoot): void {
    if (injected) { return; }
    injected = true;
    const style = document.createElement("style");
    style.id = "colyseus-debug-base-styles";
    style.textContent = CSS;
    root.appendChild(style);
}
