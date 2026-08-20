/**
 * Debug panel for `Predict` instances published via the global registry.
 *
 * `@colyseus/sdk/debug` installs a tiny `globalThis.__colyseusDebug.publish()`
 * receiver. Any prediction layer (Predict, PredictedEvents, etc.) calls into
 * it at construction time; this module renders interactive cards under the
 * debug shadow root.
 *
 * Stable contract:
 *   - The `predict` channel expects a `PredictCore` (the engine's portable
 *     introspection handle). `predict-bridge.ts` adapts it into the
 *     panel-facing `PredictDebugHandle` — deriving panel-only data (the
 *     per-profile field list) here rather than in the engine.
 *   - Handle methods are queried lazily — never persisted as fields here,
 *     so live Predict mutations stay reflected.
 *
 * Styling comes from `tokens.ts`, so the mode pills and the room panels' segmented
 * buttons stay in step by construction rather than by convention.
 */
import { getDebugRoot, getPanelStack, isOverlayVisible, preferences, PREDICT_CONTAINER_ID } from "./core.ts";
import { clearEdges, horizontalEdge, setInset, setMaxViewportHeight, verticalEdge } from "./geometry.ts";
import { applySegmentedState, bindSegmentedHover, RULE, SECONDARY, SEGMENT } from "./tokens.ts";
import { isCoarsePointer, isCompact } from "./layout.ts";
import { drawGraph } from "./panel.ts";
import {
    toDebugHandle,
    type PredictCore,
    type PredictDebugHandle,
    type PredictMode,
    type ProfileInfo,
    type ReconcilerStat,
} from "./predict-bridge.ts";

interface PredictPanelEntry {
    handle: PredictDebugHandle;
    el: HTMLElement;
    refresh: () => void;
    /** Per-reconciler drift-peak history (by label) backing the canvas graph. */
    histories: Map<string, number[]>;
}

const panels = new Map<string, PredictPanelEntry>();
let container: HTMLElement | null = null;
let pollInterval: any = null;
const POLL_MS = 250; // refresh attached count at 4 Hz


const CARD_WIDTH = "240px";

const ALL_MODES: PredictMode[] = ["lerp", "extrapolate", "damped", "reckon", "raw"];

// Compact glyphs so all five modes fit on one line; the mode name is the tooltip.
const ICON_ATTRS =
    'width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
const MODE_ICONS: Record<string, string> = {
    // lerp — linear interpolation between two snapshots
    lerp: `<svg ${ICON_ATTRS}><circle cx="3.5" cy="12.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12.5" cy="3.5" r="1.4" fill="currentColor" stroke="none"/><line x1="4.6" y1="11.4" x2="11.4" y2="4.6"/></svg>`,
    // extrapolate — project the trajectory forward past the last point
    extrapolate: `<svg ${ICON_ATTRS}><circle cx="2.5" cy="8" r="1.4" fill="currentColor" stroke="none"/><line x1="3.8" y1="8" x2="13" y2="8"/><polyline points="9.5,4.5 13,8 9.5,11.5"/></svg>`,
    // damped — oscillation settling to the target
    damped: `<svg ${ICON_ATTRS}><path d="M2 8 C 3 3 5 3 6 8 C 6.8 11 7.8 11 8.6 8 C 9.2 6.2 10 6.2 13 7.6"/></svg>`,
    // reckon — re-runs the simulation function forward (dead reckoning), so "fn"
    reckon: `<span style="font:italic 700 11px/1 ui-monospace,monospace">fn</span>`,
    // raw — snap straight to server values (discrete steps)
    raw: `<svg ${ICON_ATTRS}><polyline points="2,13 5.5,13 5.5,9 9,9 9,5 13,5"/></svg>`,
};

// -----------------------------------------------------------------------------
// Registry installation
// -----------------------------------------------------------------------------

/**
 * Render (or dedupe) a Predict card for a published core handle. The debug
 * entry (`debug.ts`) routes the `"predict"` channel of the shared
 * `globalThis.__colyseusDebug` registry here — including buffered publishes it
 * replays on install.
 */
export function onPredictPublished(core: PredictCore): void {
    if (panels.has(core.name)) return; // dedupe
    // Adapt the engine's portable core into the panel-facing handle (derives
    // the per-profile field list from the core's track stream).
    const handle = toDebugHandle(core);
    const el = renderCard(handle);
    getContainer().appendChild(el);
    const entry: PredictPanelEntry = {
        handle, el,
        refresh: () => updateCardLive(handle, entry),
        histories: new Map(),
    };
    panels.set(handle.name, entry);
    handle.onDispose(() => {
        const e = panels.get(handle.name);
        if (!e) return;
        e.el.remove();
        panels.delete(handle.name);
        if (panels.size === 0) stopPolling();
        syncHeaderNames(); // name may now be redundant (back to a lone panel)
    });
    startPolling();
    syncHeaderNames(); // name is now a disambiguator if this made it 2+
}

/**
 * Show each panel's instance name in its header ONLY when more than one Predict
 * panel is mounted. The name is a disambiguator between cards — with a single
 * instance it carries no information and is often a stale/misleading artifact
 * (e.g. an instance named after one of its own attach-groups). The name still
 * lives on the handle (keys the panel map, collapse state, and graph ids); this
 * only governs whether the header renders it.
 */
function syncHeaderNames(): void {
    const show = panels.size > 1;
    for (const entry of panels.values()) {
        const nameEl = entry.el.querySelector<HTMLElement>('[data-role="name"]');
        if (nameEl) nameEl.textContent = show ? ` ${entry.handle.name}` : "";
    }
}

// -----------------------------------------------------------------------------
// Container
// -----------------------------------------------------------------------------

// Deliberately tighter than the room panels' 14px EDGE_INSET: the Predict card
// floats in the opposite corner, so the extra 2px of breathing room buys nothing.
const PREDICT_INSET = 12;

function getContainer(): HTMLElement {
    if (container) return container;
    container = document.createElement("div");
    container.id = PREDICT_CONTAINER_ID;
    container.className = "cds-surface";
    Object.assign(container.style, {
        // Honor a session that hid the overlay — or a phone that hasn't revealed it —
        // before Predict mounted.
        display: isOverlayVisible() ? "flex" : "none",
        flexDirection: "column",
        gap: "8px",
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#fff",
        pointerEvents: "auto",
    });
    positionPredictContainer(); // parents it, and owns everything positional
    return container;
}


/**
 * Place the Predict overlay relative to the room panels, which own the corner
 * named by the `panelPosition` preference.
 *
 * Desktop floats it in the horizontally-opposite corner — two corners on the same
 * edge can't collide on a wide screen, and it preserves the historical top-left
 * look. Compact instead *reparents* it into the room-panel drawer as the last card,
 * so one scroll container holds everything. Anchoring it to the opposite edge only
 * worked while both stacks were collapsed; expanded, they meet in the middle.
 */
export function positionPredictContainer(): void {
    if (!container) return;

    const style = container.style;
    const cards = container.querySelectorAll<HTMLElement>("[data-name]");

    if (isCompact()) {
        const stack = getPanelStack();
        if (container.parentNode !== stack) { stack.appendChild(container); }

        // A flow child of the drawer: the drawer scrolls, anchors, and clips.
        style.position = "static";
        clearEdges(container);
        style.width = "auto";
        style.maxHeight = "none";
        style.zIndex = "";
        style.flexShrink = "0";
        container.classList.remove("cds-scroll");
        for (const card of cards) { card.style.width = "auto"; }
        return;
    }

    // parentNode, not parentElement: a ShadowRoot is not an Element, so a direct
    // child of one reports a null parentElement and we'd re-append every reflow.
    const root = getDebugRoot();
    if (container.parentNode !== root) { root.appendChild(container); }

    const position = preferences.panelPosition.position;
    const vertical = verticalEdge(position);
    const oppositeHorizontal = horizontalEdge(position) === "right" ? "left" : "right";

    // Above any game HUD — the room panels settle for z-index 999, but Predict is
    // read continuously while playing.
    style.position = "fixed";
    style.zIndex = "2147483645";
    style.width = "";
    style.flexShrink = "";
    container.classList.add("cds-scroll");

    clearEdges(container);
    setInset(container, vertical, PREDICT_INSET);
    setInset(container, oppositeHorizontal, PREDICT_INSET);
    setMaxViewportHeight(container, "80vh");

    for (const card of cards) { card.style.width = CARD_WIDTH; }
}

// -----------------------------------------------------------------------------
// Collapse state — persisted per instance for the session (like the hidden flag)
// -----------------------------------------------------------------------------

const COLLAPSE_KEY = "colyseus-debug-predict-collapsed";
// Which profiles have their tuning sliders open. Sub-cards are rebuilt whenever the
// profile set changes, so an in-memory flag would evaporate under the 4 Hz poll.
const TUNING_KEY = "colyseus-debug-predict-tuning";

function readSessionSet(storageKey: string): Set<string> {
    try {
        const arr = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
        return new Set(Array.isArray(arr) ? arr : []);
    } catch {
        return new Set();
    }
}

function updateSessionSet(storageKey: string, member: string, present: boolean): void {
    const set = readSessionSet(storageKey);
    if (present) set.add(member);
    else set.delete(member);
    try {
        sessionStorage.setItem(storageKey, JSON.stringify([...set]));
    } catch {
        // storage unavailable — ignore
    }
}

const readCollapsed = () => readSessionSet(COLLAPSE_KEY);
const setCollapsed = (name: string, collapsed: boolean) => updateSessionSet(COLLAPSE_KEY, name, collapsed);

// -----------------------------------------------------------------------------
// Mode pills (segmented buttons, styled like panel.ts action buttons)
// -----------------------------------------------------------------------------

// Instant tooltip — the native `title` attribute waits ~1s before showing.
let tooltipEl: HTMLElement | null = null;

function getTooltip(): HTMLElement {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement("div");
    tooltipEl.style.cssText =
        "position:fixed;z-index:2147483646;pointer-events:none;display:none;white-space:nowrap;" +
        "background:rgba(0,0,0,0.95);color:#fff;font-family:monospace;font-size:10px;" +
        "padding:3px 6px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.5)";
    getDebugRoot().appendChild(tooltipEl);
    return tooltipEl;
}

function showTooltip(text: string, anchor: HTMLElement): void {
    const tip = getTooltip();
    tip.textContent = text;
    tip.style.display = "block";
    const r = anchor.getBoundingClientRect(); // viewport coords — matches position:fixed
    tip.style.left = `${r.left}px`;
    tip.style.top = `${r.bottom + 4}px`;
}

function hideTooltip(): void {
    if (tooltipEl) tooltipEl.style.display = "none";
}

function createPill(value: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    // Height-only target + flex share: five 44px-wide pills would wrap out of the card.
    btn.className = "cds-hit-y";
    btn.dataset.value = value;
    btn.setAttribute("aria-label", value);
    btn.innerHTML = MODE_ICONS[value] ?? value;
    btn.style.cssText =
        "flex:1;display:inline-flex;align-items:center;justify-content:center;padding:4px 6px;line-height:0;" +
        "border:1px solid;border-radius:4px;cursor:pointer;transition:background .2s,border-color .2s";
    applySegmentedState(btn, active);
    bindSegmentedHover(btn, () => {
        // A tap fires mouseenter with no matching mouseleave, stranding the tooltip.
        // It only names the icon — the pill's real job is selecting the mode.
        if (!isCoarsePointer()) showTooltip(value, btn); // instant — names the icon on hover
    }, hideTooltip);
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
    });
    return btn;
}

/** Build a fresh row of mode pills; selecting one restyles its siblings then fires `onSelect`. */
function renderModePills(host: HTMLElement, current: PredictMode, onSelect: (m: PredictMode) => void): void {
    host.innerHTML = "";
    for (const m of ALL_MODES) {
        host.appendChild(createPill(m, m === current, () => {
            for (const sib of host.querySelectorAll<HTMLElement>("button")) {
                applySegmentedState(sib, sib.dataset.value === m);
            }
            onSelect(m);
        }));
    }
}

function syncModePills(host: HTMLElement, current: PredictMode): void {
    for (const pill of host.querySelectorAll<HTMLElement>("button")) {
        applySegmentedState(pill, pill.dataset.value === current);
    }
}

// -----------------------------------------------------------------------------
// Card rendering
// -----------------------------------------------------------------------------

function renderCard(handle: PredictDebugHandle): HTMLElement {
    const card = document.createElement("div");
    card.dataset.name = handle.name;
    card.style.cssText =
        `width:${CARD_WIDTH};background:rgba(0,0,0,0.85);color:#fff;font-family:monospace;` +
        "font-size:11px;border-radius:6px;padding:8px;box-shadow:0 4px 12px rgba(0,0,0,0.5)";
    if (isCompact()) { card.style.width = "auto"; }

    const collapsed = readCollapsed().has(handle.name);

    // header (attached count + collapse chevron, stays visible when collapsed) / body
    card.innerHTML = `
        <div data-role="header" class="cds-hit-y" style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:bold;border-bottom:1px solid ${RULE};padding-bottom:4px;cursor:pointer;user-select:none">
            <span>Predict<span data-role="name" style="color:${SECONDARY};font-weight:normal"></span></span>
            <span style="display:flex;align-items:center;gap:8px;font-weight:normal">
                <span data-role="attached" title="attached instances" style="color:${SECONDARY};font-variant-numeric:tabular-nums"></span>
                <span data-role="chevron" style="color:${SECONDARY}">${collapsed ? "▸" : "▾"}</span>
            </span>
        </div>
        <div data-role="body" style="display:${collapsed ? "none" : "flex"};flex-direction:column;gap:8px;margin-top:6px">
            <div data-role="reconcilers" style="display:none;flex-direction:column;gap:6px"></div>
            <div data-role="profiles" style="display:none;flex-direction:column;gap:6px"></div>
        </div>
    `;

    // Header name is set by syncHeaderNames() — shown only when >1 panel exists.
    card.querySelector<HTMLElement>('[data-role="attached"]')!.textContent = String(handle.attachedCount());

    const header = card.querySelector<HTMLElement>('[data-role="header"]')!;
    const body = card.querySelector<HTMLElement>('[data-role="body"]')!;
    const chevron = card.querySelector<HTMLElement>('[data-role="chevron"]')!;
    header.addEventListener("click", () => {
        const nowCollapsed = body.style.display !== "none";
        body.style.display = nowCollapsed ? "none" : "flex";
        chevron.textContent = nowCollapsed ? "▸" : "▾";
        setCollapsed(handle.name, nowCollapsed);
    });

    // No card-level "defaults" picker: per-attach-group profiles own every
    // slot, so editing the defaults is inert for the common case. The defaults
    // surface only as a sub-card, and only when something actually tracks it
    // (see renderProfileSubcards).
    renderProfileSubcards(card, handle);
    return card;
}

/**
 * Render one sub-card per profile. Per-attach-group profiles always show; the
 * mutable defaults profile (#0) shows ONLY when something actually tracks it
 * (`fields.length > 0`) — i.e. only when editing it has an effect. With the
 * common `attachAll` usage every slot is group-owned, so the defaults stay
 * hidden. Sticky DOM: only rebuilds when the set of profile IDs changes,
 * otherwise patches text/value in place — keeps slider focus and avoids reflow
 * churn on the 4 Hz poll.
 */
function renderProfileSubcards(card: HTMLElement, handle: PredictDebugHandle): void {
    const host = card.querySelector<HTMLElement>('[data-role="profiles"]')!;
    const profiles = handle.profiles().filter((p) => !p.isDefault || p.fields.length > 0);
    host.style.display = profiles.length ? "flex" : "none"; // no empty gap when none

    const key = profiles.map((p) => p.id).join(",");
    if (host.dataset.key !== key) {
        host.dataset.key = key;
        host.innerHTML = "";
        for (const p of profiles) {
            host.appendChild(buildProfileSubcard(handle, p));
        }
    } else {
        // Same profile set — refresh per-profile sub-card state so slider
        // values + mode pills reflect any mutations (e.g. another panel
        // tweaking the same profile, or `setProfile` calls from code).
        const nodes = host.children;
        for (let i = 0; i < profiles.length; i++) {
            refreshProfileSubcard(nodes[i] as HTMLElement, handle, profiles[i]);
        }
    }
}

function buildProfileSubcard(handle: PredictDebugHandle, p: ProfileInfo): HTMLElement {
    const el = document.createElement("div");
    el.dataset.profileId = String(p.id);
    el.dataset.tuneKey = `${handle.name}#${p.id}`;
    el.style.cssText =
        "border-top:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);" +
        "border-radius:4px;padding:6px;display:flex;flex-direction:column;gap:4px";
    el.innerHTML = `
        <div data-role="fields" style="font-size:10px;display:flex;align-items:baseline;gap:6px">
            <span data-role="cat" style="color:#fff;font-weight:bold"></span>
            <span data-role="fieldnames" style="color:${SECONDARY}"></span>
        </div>
        <div data-role="modes" style="display:flex;gap:4px;flex-wrap:wrap"></div>
        <button data-role="tune" type="button" class="cds-hit-y" style="display:none;align-items:center;gap:5px;
            width:100%;padding:3px 2px;border:none;border-radius:3px;background:none;color:${SECONDARY};
            font-family:inherit;font-size:10px;text-align:left;cursor:pointer;
            transition:background .15s,color .15s">
            <span data-role="tune-chevron">▸</span><span data-role="tune-label"></span>
        </button>
        <div data-role="sliders" style="display:none;flex-direction:column;gap:3px"></div>
    `;

    const modesEl = el.querySelector<HTMLElement>('[data-role="modes"]')!;
    renderModePills(modesEl, p.mode, (m) => {
        try {
            handle.setProfile(p.id, { mode: m });
            renderProfileSliders(el, handle, p.id, m);
        } catch (err) {
            console.error("[predict-debug] setProfile failed:", err);
        }
    });

    const tune = el.querySelector<HTMLElement>('[data-role="tune"]')!;
    tune.addEventListener("mouseenter", () => { tune.style.background = SEGMENT.background; tune.style.color = "#fff"; });
    tune.addEventListener("mouseleave", () => { tune.style.background = "none"; tune.style.color = SECONDARY; });
    tune.addEventListener("click", (e) => {
        e.stopPropagation(); // never reaches the card header, which would collapse the card
        const key = el.dataset.tuneKey!;
        updateSessionSet(TUNING_KEY, key, !readSessionSet(TUNING_KEY).has(key));
        syncTuning(el);
    });

    refreshProfileSubcard(el, handle, p);
    return el;
}


/**
 * Show the sliders only when the profile has any, and only when the user asked.
 * Tuning is a rare, deliberate act; the sliders would otherwise triple the height of
 * every sub-card just to sit untouched.
 */
function syncTuning(subcard: HTMLElement): void {
    const sliders = subcard.querySelector<HTMLElement>('[data-role="sliders"]')!;
    const tune = subcard.querySelector<HTMLElement>('[data-role="tune"]')!;
    const chevron = subcard.querySelector<HTMLElement>('[data-role="tune-chevron"]')!;
    const label = subcard.querySelector<HTMLElement>('[data-role="tune-label"]')!;

    const count = sliders.children.length;
    if (count === 0) {
        // `reckon` and `raw` take no parameters — no affordance for an empty drawer.
        tune.style.display = "none";
        sliders.style.display = "none";
        return;
    }

    const expanded = readSessionSet(TUNING_KEY).has(subcard.dataset.tuneKey!);
    tune.style.display = "flex";
    chevron.textContent = expanded ? "▾" : "▸";
    label.textContent = `${count} parameter${count === 1 ? "" : "s"}`;
    sliders.style.display = expanded ? "flex" : "none";
}

function refreshProfileSubcard(el: HTMLElement, handle: PredictDebugHandle, p: ProfileInfo): void {
    // Category (attach-group label) + the fields it covers, e.g. "enemies · x, y, vx".
    const catEl = el.querySelector<HTMLElement>('[data-role="cat"]')!;
    const namesEl = el.querySelector<HTMLElement>('[data-role="fieldnames"]')!;
    catEl.textContent = p.label ? `${p.label} ·` : (p.isDefault ? "default ·" : "");
    namesEl.textContent = p.fields.length === 0 ? "(no fields)" : p.fields.join(", ");

    syncModePills(el.querySelector<HTMLElement>('[data-role="modes"]')!, p.mode);

    // Re-render sliders only when the mode changed, otherwise patch in place
    // so user-dragged sliders don't snap back on the poll cycle.
    const slidersEl = el.querySelector<HTMLElement>('[data-role="sliders"]')!;
    if (slidersEl.dataset.mode !== p.mode) {
        renderProfileSliders(el, handle, p.id, p.mode);
    }
}

function renderProfileSliders(subcard: HTMLElement, handle: PredictDebugHandle, id: number, mode: PredictMode): void {
    const slidersEl = subcard.querySelector<HTMLElement>('[data-role="sliders"]')!;
    slidersEl.dataset.mode = mode;
    slidersEl.innerHTML = "";
    const p = handle.profiles().find((x) => x.id === id);
    if (!p) { syncTuning(subcard); return; }
    if (mode === "lerp") {
        addSlider(slidersEl, "delay (ms)", 0, 300, p.delay, (v) =>
            handle.setProfile(id, { delay: v }));
        addSlider(slidersEl, "tickInterval (ms, 0=off)", 0, 100, p.tickInterval ?? 0, (v) =>
            handle.setProfile(id, { tickInterval: v }));
        addSlider(slidersEl, "smoothMs (0=off)", 0, 300, p.smoothMs, (v) =>
            handle.setProfile(id, { smoothMs: v }));
    } else if (mode === "extrapolate") {
        addSlider(slidersEl, "maxExtrapolate (ms)", 0, 300, p.maxExtrapolate, (v) =>
            handle.setProfile(id, { maxExtrapolate: v }));
        addSlider(slidersEl, "tickInterval (ms, 0=off)", 0, 100, p.tickInterval ?? 0, (v) =>
            handle.setProfile(id, { tickInterval: v }));
        addSlider(slidersEl, "smoothMs (0=off)", 0, 300, p.smoothMs, (v) =>
            handle.setProfile(id, { smoothMs: v }));
    } else if (mode === "damped") {
        addSlider(slidersEl, "smoothMs (0=snap)", 0, 300, p.smoothMs, (v) =>
            handle.setProfile(id, { smoothMs: v }));
    }
    if (mode === "lerp" || mode === "extrapolate" || mode === "damped") {
        // Value units are game-specific — widen the range to fit the config.
        const snap = p.snap ?? 0;
        addSlider(slidersEl, "snap (units, 0=off)", 0, Math.max(20, Math.ceil(snap * 2)), snap, (v) =>
            handle.setProfile(id, { snap: v }));
    }

    // The parameter count is mode-specific, so the toggle re-labels on every switch.
    syncTuning(subcard);
}

// -----------------------------------------------------------------------------
// Mode-specific slider rendering
// -----------------------------------------------------------------------------

function addSlider(
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    initial: number,
    onChange: (value: number) => void,
): void {
    // Two lines: label + value on top, full-width track below — long labels can
    // never push the value readout past the card edge.
    const row = document.createElement("label");
    row.style.cssText = `display:flex;flex-direction:column;gap:2px;font-size:10px;color:${SECONDARY}`;
    row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px">
            <span>${label}</span>
            <span data-role="val" style="color:#fff;font-variant-numeric:tabular-nums"></span>
        </div>
        <input type="range" min="${min}" max="${max}" value="${initial}" style="width:100%;margin:0;accent-color:#fff"/>
    `;
    const input = row.querySelector<HTMLInputElement>("input")!;
    const num = row.querySelector<HTMLElement>('[data-role="val"]')!;
    num.textContent = String(initial);
    input.addEventListener("input", () => {
        const v = Number(input.value);
        num.textContent = String(v);
        try {
            onChange(v);
        } catch (err) {
            console.error("[predict-debug] slider update failed:", err);
        }
    });
    parent.appendChild(row);
}

// -----------------------------------------------------------------------------
// Live polling
// -----------------------------------------------------------------------------

function updateCardLive(handle: PredictDebugHandle, entry: PredictPanelEntry): void {
    entry.el.querySelector<HTMLElement>('[data-role="attached"]')!.textContent =
        String(handle.attachedCount());
    renderReconcilers(entry, handle);
    renderProfileSubcards(entry.el, handle);
}

// -----------------------------------------------------------------------------
// Reconciler drift (divergence vs jitter)
// -----------------------------------------------------------------------------

/** Drift-EMA samples kept per reconciler for the canvas graph (4 Hz poll). */
const GRAPH_LEN = 64;
const GRAPH_W = 200;
const GRAPH_H = 30;

function fmtDrift(v: number): string {
    if (v < 1e-3) { return "0"; }            // below any status floor — float noise
    if (v < 1) { return v.toFixed(3); }      // keep small REAL drift legible (0.003)
    if (v < 10) { return v.toFixed(2); }
    return v.toFixed(1);
}

// Status → glanceable word, colour, and the one-line action a developer takes.
// The whole point of the panel: not "drift 0.42" but "here's what it means and
// what to do". (Mirrors classifyDrift + the warnOnDivergence message.)
const STATUS: Record<string, { word: string; color: string; action: string }> = {
    matched:   { word: "✓ matched",   color: "#6c9", action: "" },
    jitter:    { word: "~ jitter",    color: "#dc7", action: "transient spikes (packet loss / reorder) — raise smoothMs or ignore; not a bug" },
    diverging: { word: "✗ diverging", color: "#e66", action: "client/server sim disagree — check dt · shared step · constants · skipped inputs" },
};

/** Stable canvas id per reconciler row (Predict name + index), so `drawGraph`'s
 *  `getElementById` resolves it within the debug shadow root. */
function graphId(name: string, i: number): string {
    return `predict-rc-graph-${name.replace(/[^a-z0-9]/gi, "-")}-${i}`;
}

function renderReconcilers(entry: PredictPanelEntry, handle: PredictDebugHandle): void {
    const host = entry.el.querySelector<HTMLElement>('[data-role="reconcilers"]')!;
    const stats = handle.reconcilers();
    if (stats.length === 0) { host.style.display = "none"; return; }
    host.style.display = "flex";
    // Rebuild rows only when the reconciler count changes (cheap steady state).
    if (host.childElementCount !== stats.length) {
        host.innerHTML = "";
        for (let i = 0; i < stats.length; i++) { host.appendChild(buildReconcilerRow(graphId(handle.name, i))); }
    }
    for (let i = 0; i < stats.length; i++) {
        refreshReconcilerRow(host.children[i] as HTMLElement, stats[i], entry, graphId(handle.name, i));
    }
}

function buildReconcilerRow(canvasId: string): HTMLElement {
    const row = document.createElement("div");
    // Distinct from the smoothing-profile sub-cards: a status-coloured LEFT
    // accent (recoloured each refresh) marks this as the prediction-health card,
    // not another smoothing profile.
    row.style.cssText =
        `border:1px solid ${RULE};border-left:3px solid ${SECONDARY};` +
        "background:rgba(255,255,255,0.04);border-radius:4px;padding:6px;" +
        "display:flex;flex-direction:column;gap:4px";
    row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
            <span data-role="rc-label" style="color:#fff;font-weight:bold"></span>
            <span data-role="rc-status" style="font-weight:bold;white-space:nowrap"></span>
        </div>
        <canvas id="${canvasId}" width="${GRAPH_W}" height="${GRAPH_H}" title="drift peak over time (auto-scaled; flat when matched)" style="display:block;width:100%;height:${GRAPH_H}px"></canvas>
        <div data-role="rc-action" style="font-size:10px;line-height:1.3"></div>
        <div data-role="rc-stats" style="color:${SECONDARY};font-size:10px;font-variant-numeric:tabular-nums"></div>
    `;
    return row;
}

function refreshReconcilerRow(row: HTMLElement, stat: ReconcilerStat, entry: PredictPanelEntry, canvasId: string): void {
    let hist = entry.histories.get(stat.label);
    if (!hist) { hist = []; entry.histories.set(stat.label, hist); }
    // Plot the drift PEAK (spikes for jitter, level for divergence), pinned to 0
    // when matched. `drawGraph` auto-scales to its own min/max, so feeding it the
    // matched-state EMA amplified float-noise into wild oscillation while the
    // numbers read "0". Pinning to 0 keeps the line flat at rest — and non-matched
    // peaks are always ≥ the status floor, so they're real, not noise.
    hist.push(stat.status === "matched" ? 0 : stat.peak);
    if (hist.length > GRAPH_LEN) { hist.shift(); }

    const v = STATUS[stat.status] ?? STATUS.matched;
    const sev = stat.status === "diverging" && stat.severity !== undefined
        ? `  ${stat.severity.toFixed(1)}× tol` : "";

    row.style.borderLeftColor = v.color;
    row.querySelector<HTMLElement>('[data-role="rc-label"]')!.textContent = stat.label;
    const statusEl = row.querySelector<HTMLElement>('[data-role="rc-status"]')!;
    statusEl.style.color = v.color;
    statusEl.textContent = `${v.word}${sev}`;

    // Reuse the shared canvas line-graph renderer (same as bytes/messages-per-sec).
    drawGraph(canvasId, hist, v.color);

    const action = row.querySelector<HTMLElement>('[data-role="rc-action"]')!;
    action.style.display = v.action ? "block" : "none";   // matched ⇒ no action line
    action.style.color = v.color;
    action.textContent = v.action;

    row.querySelector<HTMLElement>('[data-role="rc-stats"]')!.textContent =
        `drift ${fmtDrift(stat.ema)} · pk ${fmtDrift(stat.peak)} · Δ ${fmtDrift(stat.lastCorrectionMag)}`;
}

function startPolling(): void {
    if (pollInterval !== null) return;
    pollInterval = setInterval(() => {
        for (const entry of panels.values()) entry.refresh();
    }, POLL_MS);
}

function stopPolling(): void {
    if (pollInterval === null) return;
    clearInterval(pollInterval);
    pollInterval = null;
}
