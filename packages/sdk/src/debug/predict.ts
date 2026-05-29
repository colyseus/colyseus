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
 */
import { getDebugRoot } from "./core.ts";
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
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        zIndex: "2147483645",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
        fontSize: "11px",
        color: "#d8e2f0",
        pointerEvents: "auto",
    });
    root.appendChild(container);
    return container;
}

// -----------------------------------------------------------------------------
// Card rendering
// -----------------------------------------------------------------------------

function renderCard(handle: PredictDebugHandle): HTMLElement {
    const card = document.createElement("div");
    Object.assign(card.style, {
        width: "260px",
        background: "rgba(10, 15, 26, 0.92)",
        border: "1px solid #24304a",
        borderRadius: "6px",
        padding: "8px 10px",
        backdropFilter: "blur(6px)",
    });

    card.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span style="font-weight:600;color:#9fb4d8">Predict</span>
            <span data-role="name" style="color:#6cc3ff;font-family:ui-monospace,monospace"></span>
        </div>

        <div data-role="modes" style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap"></div>

        <div data-role="sliders" style="display:flex;flex-direction:column;gap:4px;margin-bottom:6px"></div>

        <div data-role="profiles" style="display:flex;flex-direction:column;gap:6px;margin-bottom:6px"></div>

        <div style="display:grid;grid-template-columns:1fr auto;gap:4px;font-size:10px;line-height:1.4;color:#9fb4d8">
            <span>attached</span><span data-role="attached" style="font-variant-numeric:tabular-nums;color:#d8e2f0"></span>
        </div>
    `;

    card.querySelector<HTMLElement>('[data-role="name"]')!.textContent = handle.name;

    // All four modes are selectable. Reckon-only attaches still render under
    // a smoothing mode (slots are dual-allocated by the SDK's Predict.attach
    // for reckon configs); smoothing-only attaches still fall through under
    // reckon mode because they have no simulated state.
    const modesEl = card.querySelector<HTMLElement>('[data-role="modes"]')!;
    const allModes: Array<"lerp" | "extrapolate" | "damped" | "reckon" | "raw"> =
        ["lerp", "extrapolate", "damped", "reckon", "raw"];
    const currentMode = handle.mode();
    for (const m of allModes) {
        const label = document.createElement("label");
        label.style.cssText = "display:flex;align-items:center;gap:3px;cursor:pointer";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = `predict-${handle.name}-mode`;
        radio.value = m;
        radio.checked = m === currentMode;
        radio.addEventListener("change", () => {
            if (!radio.checked) return;
            try {
                handle.setDefaults({ mode: m } as any);
                renderSliders(card, handle);
            } catch (err) {
                console.error("[predict-debug] setDefaults failed:", err);
            }
        });
        label.appendChild(radio);
        label.appendChild(document.createTextNode(m));
        modesEl.appendChild(label);
    }

    renderSliders(card, handle);
    renderProfileSubcards(card, handle);
    return card;
}

/**
 * Render one sub-card per non-default profile. The defaults profile is
 * already exposed via the main card's mode picker + sliders, so it's elided
 * here to avoid duplication. Sticky DOM: only rebuilds when the set of
 * profile IDs changes, otherwise patches text/value in place — keeps slider
 * focus and avoids reflow churn on the 4 Hz poll.
 */
function renderProfileSubcards(card: HTMLElement, handle: PredictDebugHandle): void {
    const host = card.querySelector<HTMLElement>('[data-role="profiles"]')!;
    const profiles = handle.profiles().filter((p) => !p.isDefault);

    const key = profiles.map((p) => p.id).join(",");
    if (host.dataset.key !== key) {
        host.dataset.key = key;
        host.innerHTML = "";
        for (const p of profiles) {
            host.appendChild(buildProfileSubcard(handle, p));
        }
    } else {
        // Same profile set — refresh per-profile sub-card state so slider
        // values + mode radios reflect any mutations (e.g. another panel
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
        "border:1px solid #1d2740;border-radius:4px;padding:6px 8px;" +
        "background:rgba(255,255,255,0.02);display:flex;flex-direction:column;gap:4px";
    el.innerHTML = `
        <div data-role="fields" style="font-size:10px;display:flex;align-items:baseline;gap:6px;font-family:ui-monospace,monospace">
            <span data-role="cat" style="color:#6cc3ff;font-weight:600"></span>
            <span data-role="fieldnames" style="color:#8aa1c6"></span>
        </div>
        <div data-role="modes" style="display:flex;gap:6px;flex-wrap:wrap;font-size:10px;color:#9fb4d8"></div>
        <div data-role="sliders" style="display:flex;flex-direction:column;gap:3px"></div>
    `;

    const modesEl = el.querySelector<HTMLElement>('[data-role="modes"]')!;
    const modes: PredictMode[] = ["lerp", "extrapolate", "damped", "reckon", "raw"];
    for (const m of modes) {
        const label = document.createElement("label");
        label.style.cssText = "display:flex;align-items:center;gap:3px;cursor:pointer";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = `predict-${handle.name}-profile-${p.id}-mode`;
        radio.value = m;
        radio.dataset.mode = m;
        radio.addEventListener("change", () => {
            if (!radio.checked) return;
            try {
                handle.setProfile(p.id, { mode: m });
                renderProfileSliders(el, handle, p.id, m);
            } catch (err) {
                console.error("[predict-debug] setProfile failed:", err);
            }
        });
        label.appendChild(radio);
        label.appendChild(document.createTextNode(m));
        modesEl.appendChild(label);
    }

    refreshProfileSubcard(el, handle, p);
    return el;
}

function refreshProfileSubcard(el: HTMLElement, handle: PredictDebugHandle, p: ProfileInfo): void {
    // Category (attach-group label) + the fields it covers, e.g. "enemies · x, y, vx".
    const catEl = el.querySelector<HTMLElement>('[data-role="cat"]')!;
    const namesEl = el.querySelector<HTMLElement>('[data-role="fieldnames"]')!;
    catEl.textContent = p.label ? `${p.label} ·` : "";
    namesEl.textContent = p.fields.length === 0 ? "(no fields)" : p.fields.join(", ");

    const modesEl = el.querySelector<HTMLElement>('[data-role="modes"]')!;
    for (const radio of modesEl.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
        radio.checked = radio.dataset.mode === p.mode;
    }

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

function renderSliders(card: HTMLElement, handle: PredictDebugHandle): void {
    const slidersEl = card.querySelector<HTMLElement>('[data-role="sliders"]')!;
    slidersEl.innerHTML = "";
    const mode = handle.mode();

    if (mode === "lerp") {
        addSlider(slidersEl, "delay (ms)", 0, 300, handle.smoothingDefaults().delay, (v) =>
            handle.setDefaults({ mode: "lerp", delay: v } as any));
        addSlider(slidersEl, "tickInterval (ms, 0=off)", 0, 100, handle.smoothingDefaults().tickInterval ?? 0, (v) =>
            handle.setDefaults({ mode: "lerp", tickInterval: v } as any));
    } else if (mode === "extrapolate") {
        addSlider(slidersEl, "maxExtrapolate (ms)", 0, 300, handle.smoothingDefaults().maxExtrapolate, (v) =>
            handle.setDefaults({ mode: "extrapolate", maxExtrapolate: v } as any));
        addSlider(slidersEl, "tickInterval (ms, 0=off)", 0, 100, handle.smoothingDefaults().tickInterval ?? 0, (v) =>
            handle.setDefaults({ mode: "extrapolate", tickInterval: v } as any));
    } else if (mode === "damped") {
        addSlider(slidersEl, "damping", 2, 40, handle.smoothingDefaults().damping, (v) =>
            handle.setDefaults({ mode: "damped", damping: v } as any));
    } else if (mode === "reckon") {
        addSlider(slidersEl, "smoothing", 0, 40, handle.reckonDefaults().smoothing, (v) =>
            handle.setDefaults({ mode: "reckon", smoothing: v } as any));
        addSlider(slidersEl, "substep (ms)", 1, 64, handle.reckonDefaults().substep, (v) =>
            handle.setDefaults({ mode: "reckon", substep: v } as any));
    }
}

function addSlider(
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    initial: number,
    onChange: (value: number) => void,
): void {
    const row = document.createElement("label");
    row.style.cssText = "display:flex;align-items:center;gap:6px;font-size:10px;color:#9fb4d8";
    row.innerHTML = `
        <span style="flex:1 0 100px">${label}</span>
        <input type="range" min="${min}" max="${max}" value="${initial}" style="flex:1;accent-color:#6cc3ff"/>
        <span style="width:34px;text-align:right;font-variant-numeric:tabular-nums;color:#d8e2f0"></span>
    `;
    const input = row.querySelector<HTMLInputElement>("input")!;
    const num = row.querySelector<HTMLElement>("span:last-child")!;
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
