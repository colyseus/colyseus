import type { Auth } from "../Auth.ts";
import { clearEdges, EDGE_INSET, horizontalEdge, setInset, setMaxViewportHeight, verticalEdge, type HorizontalEdge, type VerticalEdge } from "./geometry.ts";
import { isCompact } from "./layout.ts";
import { injectBaseStyles } from "./styles.ts";

// Store debug info per room
export const roomDebugInfo = new Map();

// Distance from the logo to whatever sits beside it. The logo is 21px + 10px padding
// + 3px border on each side = 47px.
const LOGO_CLEARANCE = 48;
// The compact drawer passes directly under the logo rather than beside it, so it
// wants a little more air than the 1px the desktop row gets away with.
const COMPACT_LOGO_CLEARANCE = 56;
const MENU_OFFSET = 60;

// Compact surfaces span the viewport on a phone but stop widening past this. A
// full-width 844px landscape sheet stretches four preset buttons to 200px each, and
// the drawer's stats end up marooned at one edge of an empty panel.
const COMPACT_MAX_WIDTH = 520;

// Live `client.auth` instances seen via matchmake calls (see debug.ts). Lets the
// "Clear auth token" menu action null the in-memory token, not just storage.
export const authInstances = new Set<Auth>();


// Preferences state
export const preferences = {
    maxLatency: 350, // milliseconds
    latencySimulation: {
        enabled: false,
        delay: 0, // milliseconds (one-way inbound; outbound uses half)
        jitter: 0, // milliseconds — per-message delay varies by ±jitter (order-preserving)
    },
    panelPosition: {
        position: 'top-right' // 'bottom-right', 'bottom-left', 'top-left', 'top-right'
    }
};


// Load preferences from localStorage (hidden state from sessionStorage)
export function loadPreferences() {
    try {
        const savedPrefs = localStorage.getItem('colyseus-debug-preferences') || '{}';
        const prefs = JSON.parse(savedPrefs);

        // Load position
        if (prefs.position && ['bottom-right', 'bottom-left', 'top-left', 'top-right'].includes(prefs.position)) {
            preferences.panelPosition.position = prefs.position;
        }

        // Load latency
        if (prefs.latency !== undefined && prefs.latency !== null) {
            const latencyValue = parseInt(prefs.latency, 10);
            if (!isNaN(latencyValue) && latencyValue >= 0 && latencyValue <= 500) {
                preferences.latencySimulation.delay = latencyValue;
                preferences.latencySimulation.enabled = latencyValue > 0;
            }
        }

        // Load jitter
        if (prefs.jitter !== undefined && prefs.jitter !== null) {
            const jitterValue = parseInt(prefs.jitter, 10);
            if (!isNaN(jitterValue) && jitterValue >= 0) {
                preferences.latencySimulation.jitter = jitterValue;
                if (jitterValue > 0) preferences.latencySimulation.enabled = true;
            }
        }

        // Load hidden state from sessionStorage
        if (sessionStorage.getItem('colyseus-debug-hidden') === 'true') {
            panelsHidden = true;
        }
    } catch (e) {
        // Storage might not be available or JSON parse failed, ignore
    }
}


// Save preferences to localStorage (hidden state to sessionStorage)
export function savePreferences() {
    try {
        localStorage.setItem('colyseus-debug-preferences', JSON.stringify({
            position: preferences.panelPosition.position,
            latency: preferences.latencySimulation.delay,
            jitter: preferences.latencySimulation.jitter,
        }));
        sessionStorage.setItem('colyseus-debug-hidden', panelsHidden ? 'true' : 'false');
    } catch (e) {
        // Storage might not be available, ignore
    }
}


// Panel visibility state
let panelsHidden = false;

// On a phone the room panels and the Predict overlay would sit on top of the game
// from the moment it loads, so they stay closed until the logo is tapped. Not
// persisted: a reload starts clean, which is what you want when the overlay is
// covering the thing you are trying to look at.
let compactRevealed = false;

// The compact menu takes over the drawer's box rather than stacking on top of it.
let compactMenuOpen = false;


// Shadow DOM root — isolates all debug UI from page-level CSS.
// Every SDK element is appended here so page rules like `canvas { width: 100vw }`
// can't reach (or stretch) the debug panel's sparklines, logo, menu, or modals.
let _debugShadowRoot: ShadowRoot | null = null;

export function getDebugRoot(): ShadowRoot {
    if (_debugShadowRoot) return _debugShadowRoot;
    const host = document.createElement('div');
    host.id = 'colyseus-debug-shadow-host';

    // A tap on the overlay must not also drive the game. Games listen for
    // `pointerdown`/`touchstart` on window/document, and our handlers only ever
    // stopped `click`. Start events only: swallowing `pointerup` would strand an
    // in-flight drag whose move/up listeners live on `document`. Never
    // preventDefault here — that kills slider thumbs and scrolling.
    // Limit: a game listening in the CAPTURE phase still sees these, since capture
    // runs before the target and nothing downstream can suppress it.
    ['pointerdown', 'touchstart', 'mousedown'].forEach(function(type) {
        host.addEventListener(type, function(e) { e.stopPropagation(); });
    });

    _debugShadowRoot = host.attachShadow({ mode: 'open' });
    injectBaseStyles(_debugShadowRoot);
    document.body.appendChild(host);
    return _debugShadowRoot;
}


/** The corner the `panelPosition` preference currently names. */
function anchorEdges(): { vertical: VerticalEdge; horizontal: HorizontalEdge } {
    const position = preferences.panelPosition.position;
    return { vertical: verticalEdge(position), horizontal: horizontalEdge(position) };
}


/**
 * The latency ramp: green (0) → yellow (half of `maxLatency`) → red (max).
 *
 * Drives both the logo's border ring and the network sliders' track gradient, which
 * must agree — a slider that reads amber above a green ring is just confusing.
 */
export function latencyRamp(value: number, max: number): { r: number; g: number; b: number } {
    const percentage = max > 0 ? value / max : 0;
    if (percentage <= 0.5) {
        return { r: Math.round(percentage * 2 * 200), g: 200, b: 0 };
    }
    return { r: 200, g: Math.round((1 - (percentage - 0.5) * 2) * 200), b: 0 };
}

// Function to get border color based on latency simulation value
export function getBorderColor(latencyValue, opacity) {
    var c = latencyRamp(latencyValue, preferences.maxLatency);
    return 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + opacity + ')';
}


// Apply panel position based on current setting
export function applyPanelPosition() {
    if (panelsHidden) return; // nothing mounted — don't force the shadow root into existence

    var root = getDebugRoot();
    var logoContainer = root.getElementById('debug-logo-container') as HTMLElement;
    var menu = root.getElementById('debug-menu') as HTMLElement;

    var edges = anchorEdges();
    var vertical = edges.vertical;
    var horizontal = edges.horizontal;

    if (logoContainer) {
        clearEdges(logoContainer);
        setInset(logoContainer, vertical, EDGE_INSET);
        setInset(logoContainer, horizontal, EDGE_INSET);
    }

    if (menu) { applyMenuPosition(menu, vertical, horizontal); }

    repositionDebugPanels();
    applyOverlayVisibility(); // crossing into/out of compact changes what's on screen
}


/**
 * The one box every compact surface occupies: hanging off the logo's edge, capped
 * at {@link COMPACT_MAX_WIDTH}, height-capped to the viewport, scrolling inside.
 *
 * The room drawer and the menu share it, and never appear at once — holding the
 * logo swaps one for the other in place.
 */
function applyCompactBox(el: HTMLElement, vertical: 'top' | 'bottom', horizontal: 'left' | 'right') {
    setInset(el, 'left', EDGE_INSET);
    setInset(el, 'right', EDGE_INSET);
    setInset(el, vertical, EDGE_INSET, COMPACT_LOGO_CLEARANCE);

    // Both edges are pinned, so max-width leaves slack; the auto margin spends it all
    // on one side, parking the box under the logo instead of centering it.
    el.style.maxWidth = COMPACT_MAX_WIDTH + 'px';
    el.style.marginLeft = (horizontal === 'right') ? 'auto' : '0';
    el.style.marginRight = (horizontal === 'right') ? '0' : 'auto';

    var reserved = EDGE_INSET + COMPACT_LOGO_CLEARANCE + EDGE_INSET;
    setMaxViewportHeight(el, `calc(100vh - ${reserved}px)`);
}

function clearCompactBox(el: HTMLElement) {
    el.style.maxWidth = '';
    el.style.marginLeft = '';
    el.style.marginRight = '';
    el.style.maxHeight = '';
}


// A corner-anchored dropdown on desktop; on a phone it takes over the room drawer's
// box, hanging off the logo. Either way it is capped to the viewport and scrolls: a
// short window used to clip the auth section off the bottom with no way to reach it.
function applyMenuPosition(menu: HTMLElement, vertical: 'top' | 'bottom', horizontal: 'left' | 'right') {
    clearEdges(menu);

    // Only the block axis scrolls: a horizontal scrollbar here would mean a control
    // has overflowed, and hiding it is the lesser evil.
    menu.style.overflowX = 'hidden';
    menu.style.overflowY = 'auto';
    menu.style.borderRadius = '8px';

    if (isCompact()) {
        applyCompactBox(menu, vertical, horizontal);
        menu.style.minWidth = '0';
    } else {
        clearCompactBox(menu);
        setInset(menu, horizontal, EDGE_INSET);
        menu.style[vertical] = MENU_OFFSET + 'px';
        // Pinned, not just floored: the menu shrink-to-fits, so a long unwrapped line
        // (the "remove debug.js" hint) would otherwise stretch it well past 226.
        menu.style.minWidth = '226px'; // 224 content + the 1px border on each side
        menu.style.maxWidth = '226px';
        setMaxViewportHeight(menu, `calc(100vh - ${MENU_OFFSET + EDGE_INSET}px)`);
    }
}


export const PREDICT_CONTAINER_ID = 'colyseus-debug-predict-container';

/** True when the room panels + Predict overlay should be on screen right now. */
export function isOverlayVisible(): boolean {
    if (panelsHidden) return false;
    if (!isCompact()) return true;
    // The compact menu occupies the drawer's box, so the two can't share the screen.
    return compactRevealed && !compactMenuOpen;
}

export function isCompactRevealed(): boolean { return compactRevealed; }

/** Show/hide the compact overlay content. The logo itself always stays put. */
export function setCompactRevealed(revealed: boolean) {
    compactRevealed = revealed;
    applyOverlayVisibility();
}

/** The menu is opening or closing — on compact it displaces the drawer. */
export function setCompactMenuOpen(open: boolean) {
    compactMenuOpen = open;
    applyOverlayVisibility();
}

// Both surfaces share one visibility rule. In compact the Predict card is a child of
// the stack, so hiding the stack already hides it — setting it too keeps the desktop
// case (where Predict floats free) on the same code path.
export function applyOverlayVisibility() {
    var root = getDebugRoot();
    var display = isOverlayVisible() ? 'flex' : 'none';
    var stack = root.getElementById(PANEL_STACK_ID);
    var predictContainer = root.getElementById(PREDICT_CONTAINER_ID);
    if (stack) { stack.style.display = display; }
    if (predictContainer) { predictContainer.style.display = display; }
}


// Hide panels for this session
export function hidePanelsForSession() {
    panelsHidden = true;
    savePreferences(); // Save the hidden state

    var root = getDebugRoot();
    var logoContainer = root.getElementById('debug-logo-container');
    var menu = root.getElementById('debug-menu');
    var stack = root.getElementById(PANEL_STACK_ID);
    var predictContainer = root.getElementById(PREDICT_CONTAINER_ID);

    if (logoContainer) {
        logoContainer.style.display = 'none';
    }
    if (menu) {
        menu.style.display = 'none';
    }
    if (stack) {
        stack.style.display = 'none';
    }
    // Predict panel is a sibling overlay (own id) — hide it alongside the rest.
    if (predictContainer) {
        predictContainer.style.display = 'none';
    }
}


// Helper function to format bytes
export function formatBytes(bytes) {
    if (!bytes) {
        return '0 B';
    } else if (bytes < 1) {
        bytes = 1; // avoid visual glitches
    }
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return (Math.round(bytes) / Math.pow(k, i)).toFixed(1)  + ' ' + sizes[i];
}


// Every room panel lives in one flex container rather than being individually
// positioned. Panel heights change constantly — updateDebugPanel() rewrites the
// stats markup every second and the jitter row comes and goes — so a JS-accumulated
// offset stack would drift. Flex resolves the layout for free.
const PANEL_STACK_ID = 'colyseus-debug-panel-stack';

export function getPanelStack(): HTMLElement {
    var root = getDebugRoot();
    var stack = root.getElementById(PANEL_STACK_ID) as HTMLElement;
    if (stack) { return stack; }

    stack = document.createElement('div');
    stack.id = PANEL_STACK_ID;
    stack.style.position = 'fixed';
    stack.style.display = isOverlayVisible() ? 'flex' : 'none';
    stack.style.gap = '6px';
    stack.style.zIndex = '999';
    stack.style.pointerEvents = 'none'; // gaps between panels stay clickable in the game
    root.appendChild(stack);
    repositionDebugPanels();
    return stack;
}


/**
 * Anchor the stack and pick its axis.
 *
 * Desktop keeps the historical row along the anchored edge, with Predict floating
 * in the opposite corner. Compact turns the stack into a **drawer**: one full-width
 * scrollable column that also adopts the Predict card (see positionPredictContainer).
 * Two fixed stacks growing toward each other from opposite edges only worked while
 * both were collapsed — expanded, they meet in the middle of a short screen.
 *
 * Either way the first child (oldest panel) sits nearest the anchor corner.
 */
export function repositionDebugPanels() {
    if (panelsHidden) return;

    var stack = getDebugRoot().getElementById(PANEL_STACK_ID) as HTMLElement;
    if (!stack) return;

    var edges = anchorEdges();
    var vertical = edges.vertical;
    var horizontal = edges.horizontal;
    clearEdges(stack);

    if (isCompact()) {
        stack.style.flexDirection = (vertical === 'bottom') ? 'column-reverse' : 'column';
        stack.style.alignItems = 'stretch';
        stack.style.pointerEvents = 'auto'; // the drawer is a surface, and it scrolls
        stack.classList.add('cds-scroll');
        applyCompactBox(stack, vertical, horizontal);
    } else {
        stack.style.flexDirection = (horizontal === 'right') ? 'row-reverse' : 'row';
        stack.style.alignItems = (vertical === 'top') ? 'flex-start' : 'flex-end';
        stack.style.pointerEvents = 'none'; // gaps between panels stay clickable in the game
        stack.classList.remove('cds-scroll');
        stack.style.overflowY = '';
        clearCompactBox(stack);
        setInset(stack, vertical, EDGE_INSET);
        setInset(stack, horizontal, EDGE_INSET, LOGO_CLEARANCE);
    }
}

export function isPanelsHidden(): boolean { return panelsHidden; }
