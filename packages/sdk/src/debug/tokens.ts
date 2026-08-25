/**
 * The overlay's shared visual language.
 *
 * A leaf, like `layout.ts` and `geometry.ts`. These values used to be inline string
 * literals in `panel.ts` and a private copy in `predict.ts` annotated "match the room
 * debug-panels" — a comment the compiler could not enforce. Now it can.
 */

/** Muted text: labels, secondary readouts, chevrons. */
export const SECONDARY = "#888";

/** Hairline rule inside a card or panel (the menu's grooves are deliberately louder). */
export const RULE = "rgba(255, 255, 255, 0.15)";

/**
 * Segmented buttons: the network presets, the panel-position grid, and the Predict
 * mode pills. All three are "pick exactly one of N", so all three look the same.
 */
export const SEGMENT = {
    background: "rgba(255, 255, 255, 0.05)",
    border: "rgba(255, 255, 255, 0.2)",
    hover: "rgba(255, 255, 255, 0.12)",
    foreground: "#bbb",
    activeBackground: "rgba(255, 255, 255, 0.18)",
    activeBorder: "rgba(255, 255, 255, 0.4)",
    activeForeground: "#fff",
};

/**
 * Paint a segmented button for its selected state. Callers must give the element a
 * `border:1px solid` in their own CSS — only the colour is set here, so the border
 * width never flickers between states.
 *
 * `dataset.active` is the single source of truth the hover handler reads.
 */
export function applySegmentedState(button: HTMLElement, active: boolean): void {
    button.dataset.active = active ? "true" : "false";
    button.style.background = active ? SEGMENT.activeBackground : SEGMENT.background;
    button.style.borderColor = active ? SEGMENT.activeBorder : SEGMENT.border;
    button.style.color = active ? SEGMENT.activeForeground : SEGMENT.foreground;
}

/** The hover wash every segmented button shares. Extra handlers run after it. */
export function bindSegmentedHover(button: HTMLElement, onEnter?: () => void, onLeave?: () => void): void {
    button.addEventListener("mouseenter", function() {
        if (button.dataset.active !== "true") { button.style.background = SEGMENT.hover; }
        onEnter?.();
    });
    button.addEventListener("mouseleave", function() {
        if (button.dataset.active !== "true") { button.style.background = SEGMENT.background; }
        onLeave?.();
    });
}
