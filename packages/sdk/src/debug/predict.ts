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
 * Styling mirrors the room debug-panels (`debug/panel.ts`): black translucent
 * card, white/grey monospace text, action-button-style mode pills.
 */
import { getDebugRoot, isPanelsHidden } from "./core.ts";
import {
    toDebugHandle,
    type PredictCore,
    type PredictDebugHandle,
    type PredictMode,
    type ProfileInfo,
} from "./predict-bridge.ts";

interface ChannelRegistry {
    publish(channel: string, handle: any): void;
}

interface PredictPanelEntry {
    handle: PredictDebugHandle;
    el: HTMLElement;
    refresh: () => void;
}

const panels = new Map<string, PredictPanelEntry>();
let container: HTMLElement | null = null;
let pollInterval: any = null;
const POLL_MS = 250; // refresh attached count at 4 Hz

// Style tokens — match the room debug-panels (debug/panel.ts).
const SECONDARY = "#888";
const DIVIDER = "rgba(255,255,255,0.15)";
const PILL_BORDER = "rgba(255,255,255,0.2)";
const PILL_BG = "rgba(255,255,255,0.05)";
const PILL_HOVER = "rgba(255,255,255,0.15)";
const PILL_ACTIVE_BG = "rgba(255,255,255,0.18)";
const PILL_ACTIVE_BORDER = "rgba(255,255,255,0.4)";

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

export function installPredictDebug(): void {
    const g = globalThis as { __colyseusDebug?: ChannelRegistry };
    const existing = g.__colyseusDebug;

    if (existing) {
        // Wrap any pre-existing publish so other channels still work.
        const prev = existing.publish.bind(existing);
        existing.publish = (channel, handle) => {
            if (channel === "predict") onPredictPublished(handle as PredictCore);
            else prev(channel, handle);
        };
        return;
    }

    g.__colyseusDebug = {
        publish(channel, handle) {
            if (channel === "predict") onPredictPublished(handle as PredictCore);
            // Future channels: predictedEvents, csp, …
        },
    };
}

function onPredictPublished(core: PredictCore): void {
    if (panels.has(core.name)) return; // dedupe
    // Adapt the engine's portable core into the panel-facing handle (derives
    // the per-profile field list from the core's track stream).
    const handle = toDebugHandle(core);
    const el = renderCard(handle);
    getContainer().appendChild(el);
    const entry: PredictPanelEntry = {
        handle, el,
        refresh: () => updateCardLive(handle, entry),
    };
    panels.set(handle.name, entry);
    handle.onDispose(() => {
        const e = panels.get(handle.name);
        if (!e) return;
        e.el.remove();
        panels.delete(handle.name);
        if (panels.size === 0) stopPolling();
    });
    startPolling();
}

// -----------------------------------------------------------------------------
// Container
// -----------------------------------------------------------------------------

function getContainer(): HTMLElement {
    if (container) return container;
    const root = getDebugRoot();
    container = document.createElement("div");
    container.id = "colyseus-debug-predict-container";
    Object.assign(container.style, {
        position: "fixed",
        top: "12px",
        left: "12px",
        // Honor a session that hid the whole debug overlay before Predict mounted.
        display: isPanelsHidden() ? "none" : "flex",
        flexDirection: "column",
        gap: "8px",
        zIndex: "2147483645",
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#fff",
        pointerEvents: "auto",
    });
    root.appendChild(container);
    return container;
}

// -----------------------------------------------------------------------------
// Collapse state — persisted per instance for the session (like the hidden flag)
// -----------------------------------------------------------------------------

const COLLAPSE_KEY = "colyseus-debug-predict-collapsed";

function readCollapsed(): Set<string> {
    try {
        const arr = JSON.parse(sessionStorage.getItem(COLLAPSE_KEY) || "[]");
        return new Set(Array.isArray(arr) ? arr : []);
    } catch {
        return new Set();
    }
}

function setCollapsed(name: string, collapsed: boolean): void {
    const set = readCollapsed();
    if (collapsed) set.add(name);
    else set.delete(name);
    try {
        sessionStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
    } catch {
        // storage unavailable — ignore
    }
}

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

function applyPillState(btn: HTMLElement, active: boolean): void {
    btn.dataset.active = active ? "true" : "false";
    btn.style.background = active ? PILL_ACTIVE_BG : PILL_BG;
    btn.style.border = "1px solid " + (active ? PILL_ACTIVE_BORDER : PILL_BORDER);
    btn.style.color = active ? "#fff" : "#9aa0a6"; // dim inactive glyphs so the active one reads
}

function createPill(value: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.value = value;
    btn.setAttribute("aria-label", value);
    btn.innerHTML = MODE_ICONS[value] ?? value;
    btn.style.cssText =
        "display:inline-flex;align-items:center;justify-content:center;padding:4px 6px;line-height:0;" +
        "border-radius:4px;cursor:pointer;transition:background .2s,border-color .2s";
    applyPillState(btn, active);
    btn.addEventListener("mouseenter", () => {
        if (btn.dataset.active !== "true") btn.style.background = PILL_HOVER;
        showTooltip(value, btn); // instant — names the icon on hover
    });
    btn.addEventListener("mouseleave", () => {
        if (btn.dataset.active !== "true") btn.style.background = PILL_BG;
        hideTooltip();
    });
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
                applyPillState(sib, sib.dataset.value === m);
            }
            onSelect(m);
        }));
    }
}

function syncModePills(host: HTMLElement, current: PredictMode): void {
    for (const pill of host.querySelectorAll<HTMLElement>("button")) {
        applyPillState(pill, pill.dataset.value === current);
    }
}

// -----------------------------------------------------------------------------
// Card rendering
// -----------------------------------------------------------------------------

function renderCard(handle: PredictDebugHandle): HTMLElement {
    const card = document.createElement("div");
    card.dataset.name = handle.name;
    card.style.cssText =
        "width:240px;background:rgba(0,0,0,0.85);color:#fff;font-family:monospace;" +
        "font-size:11px;border-radius:6px;padding:8px;box-shadow:0 4px 12px rgba(0,0,0,0.5)";

    const collapsed = readCollapsed().has(handle.name);

    // header (attached count + collapse chevron, stays visible when collapsed) / body
    card.innerHTML = `
        <div data-role="header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:bold;border-bottom:1px solid ${DIVIDER};padding-bottom:4px;cursor:pointer;user-select:none">
            <span>Predict <span data-role="name" style="color:${SECONDARY};font-weight:normal"></span></span>
            <span style="display:flex;align-items:center;gap:8px;font-weight:normal">
                <span data-role="attached" title="attached instances" style="color:${SECONDARY};font-variant-numeric:tabular-nums"></span>
                <span data-role="chevron" style="color:${SECONDARY}">${collapsed ? "▸" : "▾"}</span>
            </span>
        </div>
        <div data-role="body" style="display:${collapsed ? "none" : "flex"};flex-direction:column;gap:8px;margin-top:6px">
            <div data-role="profiles" style="display:none;flex-direction:column;gap:6px"></div>
        </div>
    `;

    card.querySelector<HTMLElement>('[data-role="name"]')!.textContent = handle.name;
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
    el.style.cssText =
        "border-top:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);" +
        "border-radius:4px;padding:6px;display:flex;flex-direction:column;gap:4px";
    el.innerHTML = `
        <div data-role="fields" style="font-size:10px;display:flex;align-items:baseline;gap:6px">
            <span data-role="cat" style="color:#fff;font-weight:bold"></span>
            <span data-role="fieldnames" style="color:${SECONDARY}"></span>
        </div>
        <div data-role="modes" style="display:flex;gap:4px;flex-wrap:wrap"></div>
        <div data-role="sliders" style="display:flex;flex-direction:column;gap:3px"></div>
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

    refreshProfileSubcard(el, handle, p);
    return el;
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
    if (!p) return;
    if (mode === "lerp") {
        addSlider(slidersEl, "delay (ms)", 0, 300, p.delay, (v) =>
            handle.setProfile(id, { delay: v }));
        addSlider(slidersEl, "tickInterval (ms, 0=off)", 0, 100, p.tickInterval ?? 0, (v) =>
            handle.setProfile(id, { tickInterval: v }));
    } else if (mode === "extrapolate") {
        addSlider(slidersEl, "maxExtrapolate (ms)", 0, 300, p.maxExtrapolate, (v) =>
            handle.setProfile(id, { maxExtrapolate: v }));
        addSlider(slidersEl, "tickInterval (ms, 0=off)", 0, 100, p.tickInterval ?? 0, (v) =>
            handle.setProfile(id, { tickInterval: v }));
        addSlider(slidersEl, "damping (0=off)", 0, 40, p.damping, (v) =>
            handle.setProfile(id, { damping: v }));
    } else if (mode === "damped") {
        addSlider(slidersEl, "damping", 2, 40, p.damping, (v) =>
            handle.setProfile(id, { damping: v }));
    }
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
    renderProfileSubcards(entry.el, handle);
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
