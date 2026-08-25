import { type DataChange, Metadata, Schema } from "@colyseus/schema";

/**
 * Renders a Colyseus room state tree into a DOM container and keeps it in sync
 * as the decoder reports changes.
 *
 * Update strategy:
 *
 *  - The cheap, common case — a primitive field/item value changing (player
 *    positions, scores, …) — is patched *in place*: only the text of the
 *    affected `<span>` is rewritten. The surrounding DOM keeps its identity, so
 *    in-flight clicks, text selection, focus, hover and scroll all survive, and
 *    there is no flicker.
 *
 *  - Anything structural (a key added/removed, a sub-object replaced, an array
 *    reordered) falls back to a full re-render, throttled so bursts coalesce.
 *    This matches the historical behaviour and is a safe default.
 *
 * The bridge between a change record and its DOM node is the `ref` object
 * identity carried by every `DataChange` — no schema-internal symbols are read.
 * Each rendered container ref is assigned a render-local id; primitive value
 * spans are tagged `data-vk="<ownerId>|<key>"`, so a change to `(ref, field)`
 * can be located in O(1).
 */

const VALUE_COLORS = {
    string: '#CE9178',
    number: '#B5CEA8',
    boolean: '#569CD6',
    nullish: '#858585',
} as const;

const KEY_COLOR = '#DCDCAA';
const PUNCTUATION_COLOR = '#858585';

const FULL_RENDER_THROTTLE_MS = 200;

interface Patch {
    els: HTMLElement[];
    value: any;
}

export class StateTreeView {
    private container: HTMLElement;
    private getState: () => any;

    // Paths (e.g. "root.players.abc") currently expanded. Survives re-renders.
    private expandedPaths: Set<string> = new Set(['root']);

    // Render-local id assigned to each container ref during a full render.
    // Keyed by object identity (the same instance carried in DataChange.ref).
    private refIds: Map<object, number> = new Map();
    private nextRefId: number = 1;

    // "ownerId|key" -> primitive value span(s). Rebuilt after each full render.
    // An array because a shared ref (refCount > 1) renders in multiple places.
    private valueIndex: Map<string, HTMLElement[]> = new Map();

    // Trailing-edge throttle bookkeeping for full re-renders.
    private fullRenderTimer: ReturnType<typeof setTimeout> | null = null;
    private lastFullRender: number = 0;

    // Set while the tab is hidden: change work is skipped (nothing is on screen)
    // and coalesced into a single catch-up render when the tab becomes visible.
    private dirty: boolean = false;

    constructor(container: HTMLElement, getState: () => any) {
        this.container = container;
        this.getState = getState;

        // Event delegation: a single listener survives every re-render, so
        // expand/collapse keeps working regardless of how the tree updates.
        this.container.addEventListener('click', (e: MouseEvent) => {
            const button = (e.target as HTMLElement).closest('[data-expand-button]');
            if (button) {
                e.stopPropagation();
                this.toggleExpand(button as HTMLElement);
            }
        });

        // Skip work while the tab is hidden; resync on return (see applyChanges).
        document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    /** Detach document-level listeners and timers. Call when discarding the view. */
    dispose(): void {
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        if (this.fullRenderTimer) {
            clearTimeout(this.fullRenderTimer);
            this.fullRenderTimer = null;
        }
    }

    private onVisibilityChange = (): void => {
        if (!document.hidden && this.dirty) {
            this.dirty = false;
            this.render();
        }
    };

    /** Full (re)render of the whole tree. Preserves expanded paths. */
    render(): void {
        if (this.fullRenderTimer) {
            clearTimeout(this.fullRenderTimer);
            this.fullRenderTimer = null;
        }
        this.lastFullRender = Date.now();
        this.refIds = new Map();
        this.nextRefId = 1;

        let inner: string;
        try {
            inner = this.renderNode(this.getState() || {});
        } catch (e: any) {
            this.container.innerHTML = '<div style="color: #e74856; padding: 20px;">Error accessing room state: ' + escapeHtml(e.message) + '</div>';
            this.valueIndex = new Map();
            return;
        }

        this.container.innerHTML = '<div style="font-family: \'Consolas\', \'Monaco\', \'Courier New\', monospace; font-size: 12px; line-height: 1.5; color: #d4d4d4; padding: 8px;">' + inner + '</div>';
        this.buildValueIndex();
    }

    /**
     * Apply a batch of decoder changes. Patches primitive value changes in
     * place; falls back to a (throttled) full render for anything structural.
     */
    applyChanges(changes: DataChange[]): void {
        // Tab hidden: nothing is on screen. Drop the work and remember to do a
        // single catch-up render once the tab is visible again.
        if (document.hidden) {
            this.dirty = true;
            return;
        }
        // Returned from a hidden tab with missed changes: full render to resync.
        // (Belt-and-suspenders alongside the visibilitychange listener, in case
        // a change lands before that handler runs.)
        if (this.dirty) {
            this.dirty = false;
            this.render();
            return;
        }

        // A full render is already queued — it will reflect the latest state,
        // so there is nothing useful to patch in the meantime.
        if (this.fullRenderTimer) { return; }

        const patches = this.collectPatches(changes);
        if (patches === null) {
            this.scheduleFullRender();
            return;
        }
        for (let i = 0; i < patches.length; i++) {
            this.applyPatch(patches[i]);
        }
    }

    /**
     * Returns the in-place patches for `changes`, or `null` if any change is
     * not a primitive value update on an already-rendered slot (in which case
     * the caller should do a full re-render).
     */
    private collectPatches(changes: DataChange[]): Patch[] | null {
        const patches: Patch[] = [];
        for (let i = 0; i < changes.length; i++) {
            const change = changes[i];
            if (!isPatchablePrimitive(change.value)) { return null; }

            const ownerId = this.refIds.get(change.ref as object);
            if (ownerId === undefined) { return null; }

            const key = (change.field !== undefined) ? change.field : change.dynamicIndex;
            const els = this.valueIndex.get(ownerId + '|' + String(key));
            if (!els || els.length === 0) { return null; }

            patches.push({ els, value: change.value });
        }
        return patches;
    }

    private applyPatch(patch: Patch): void {
        const formatted = formatPrimitive(patch.value);
        for (let i = 0; i < patch.els.length; i++) {
            const el = patch.els[i];
            el.textContent = formatted.text;
            el.style.color = formatted.color;
        }
    }

    private scheduleFullRender(): void {
        if (this.fullRenderTimer) { return; }
        const wait = Math.max(0, FULL_RENDER_THROTTLE_MS - (Date.now() - this.lastFullRender));
        if (wait === 0) {
            this.render();
        } else {
            this.fullRenderTimer = setTimeout(() => {
                this.fullRenderTimer = null;
                this.render();
            }, wait);
        }
    }

    private buildValueIndex(): void {
        this.valueIndex = new Map();
        const spans = this.container.querySelectorAll<HTMLElement>('[data-vk]');
        for (let i = 0; i < spans.length; i++) {
            const el = spans[i];
            const vk = el.getAttribute('data-vk');
            if (vk === null) { continue; }
            const existing = this.valueIndex.get(vk);
            if (existing) { existing.push(el); }
            else { this.valueIndex.set(vk, [el]); }
        }
    }

    private localIdFor(ref: object): number {
        let id = this.refIds.get(ref);
        if (id === undefined) {
            id = this.nextRefId++;
            this.refIds.set(ref, id);
        }
        return id;
    }

    private toggleExpand(expandButton: HTMLElement): void {
        const content = expandButton.nextElementSibling as HTMLElement | null;
        const icon = expandButton.querySelector('[data-expand-icon]');
        if (!content || !content.style) { return; }

        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'block' : 'none';
        if (icon) { icon.textContent = isHidden ? '▼' : '▶'; }

        const pathElement = expandButton.closest('[data-path]');
        if (pathElement) {
            const path = pathElement.getAttribute('data-path');
            if (path !== null) {
                if (isHidden) { this.expandedPaths.add(path); }
                else { this.expandedPaths.delete(path); }
            }
        }
    }

    /** Recursively render any value to an HTML string. */
    private renderNode(
        obj: any,
        depth: number = 0,
        parentKey: string = '',
        path: string = '',
        fieldName: string | null = null,
        vk: string | null = null,
    ): string {
        if (depth > 10) {
            return '<span style="color: ' + PUNCTUATION_COLOR + '; font-style: italic;">[Max depth reached]</span>';
        }

        if (obj === null || obj === undefined) {
            return primitiveSpan(obj, vk);
        }

        const type = typeof obj;
        if (type === 'string' || type === 'number' || type === 'boolean') {
            return primitiveSpan(obj, vk);
        }

        const indent = depth * 6;
        const currentPath = path ? path + '.' + (parentKey || '') : (parentKey || 'root');
        const isPathExpanded = this.expandedPaths.has(currentPath);

        // forEach collections (Map, Set, Array, …)
        if (typeof obj.forEach === 'function') {
            const collectionSize = (obj.size || obj.length) || null;
            const size = (collectionSize !== null ? collectionSize : '?');
            const ownerId = this.localIdFor(obj);
            const displayState = getDisplayState(depth, isPathExpanded);
            const displayLabel = fieldName !== null ? fieldName : (displayState.isRoot ? 'State' : '');

            let html = '<div style="margin-left: ' + indent + 'px;" data-path="' + escapeAttr(currentPath) + '">';
            html += renderExpandButton(displayState, displayLabel, size);
            html += '<div style="display: ' + displayState.initialDisplay + ';">';

            const isSet = obj instanceof Set || (obj.constructor && obj.constructor.name === 'Set');
            try {
                obj.forEach((value: any, key: any) => {
                    if (isSet) {
                        // Sets pass (value, value, set) — only the value matters.
                        html += this.renderNode(value, depth + 1, String(key), currentPath);
                    } else {
                        const isKeyNumber = typeof key === 'number';
                        const keyStr = isKeyNumber ? '[' + String(key) + ']' : String(key);
                        html += this.renderKeyValue(key, value, depth + 1, currentPath, keyStr, typeof key === 'string', ownerId);
                    }
                });
            } catch (e: any) {
                const errorIndent = (depth + 1) * 6;
                html += '<div style="margin-left: ' + errorIndent + 'px; color: #e74856;">Error iterating: ' + escapeHtml(e.message) + '</div>';
            }

            html += '</div></div>';
            return html;
        }

        if (type === 'object') {
            const keys = schemaFieldKeys(obj);
            const ownerId = this.localIdFor(obj);
            const displayState = getDisplayState(depth, isPathExpanded);
            const displayLabel = fieldName !== null ? fieldName : (displayState.isRoot ? 'state' : '');

            let html = '<div style="margin-left: ' + indent + 'px;" data-path="' + escapeAttr(currentPath) + '">';

            if (keys.length === 0) {
                if (displayLabel) {
                    html += '<span style="color: ' + getLabelColor(displayLabel) + ';">' + escapeHtml(String(displayLabel)) + '</span><span style="color: ' + PUNCTUATION_COLOR + ';"> {}</span>';
                } else {
                    html += '<span style="color: ' + PUNCTUATION_COLOR + ';">{}</span>';
                }
            } else {
                html += renderExpandButton(displayState, displayLabel, null);
                html += '<div style="display: ' + displayState.initialDisplay + ';">';
                for (let i = 0; i < keys.length; i++) {
                    const key = keys[i];
                    if (key === '~refId') { continue; }
                    html += this.renderKeyValue(key, obj[key], depth + 1, currentPath, key, false, ownerId);
                }
                html += '</div>';
            }

            html += '</div>';
            return html;
        }

        return primitiveSpan(obj, vk);
    }

    /** Render a single `key: value` entry of an object/collection. */
    private renderKeyValue(
        key: any,
        value: any,
        depth: number,
        currentPath: string,
        keyDisplay: string | null,
        isKeyString: boolean,
        ownerId: number,
    ): string {
        if (isExpandable(value)) {
            // Expandable values render their own container with the key as label.
            return (keyDisplay !== null)
                ? this.renderNode(value, depth, String(key), currentPath, keyDisplay)
                : this.renderNode(value, depth, String(key), currentPath);
        }

        // Primitive value: align with expandable items (icon 10px + 4px margin).
        const indent = depth * 6;
        const vk = ownerId + '|' + String(key);
        let html = '<div style="margin-left: ' + indent + 'px; padding-left: 14px;">';
        if (keyDisplay !== null) {
            const keyColor = isKeyString ? VALUE_COLORS.string : KEY_COLOR;
            const label = isKeyString ? '"' + escapeHtml(String(keyDisplay)) + '"' : escapeHtml(String(keyDisplay));
            html += '<span style="color: ' + keyColor + ';">' + label + '</span><span style="color: ' + PUNCTUATION_COLOR + ';">: </span>';
        } else {
            html += '<span style="color: ' + KEY_COLOR + ';">' + escapeHtml(String(key)) + '</span><span style="color: ' + PUNCTUATION_COLOR + ';">: </span>';
        }
        html += this.renderNode(value, depth + 1, String(key), currentPath, null, vk);
        html += '</div>';
        return html;
    }
}

// --- pure helpers -----------------------------------------------------------

function escapeHtml(text: any): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text: string): string {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Field names to render for an object node.
 *
 * A Colyseus Schema exposes its synced fields as enumerable accessors on the
 * *prototype*, so `Object.keys` (own-enumerable only) returns `[]`. Worse, a
 * `.noSync()` field is stored as an *own* property, so `Object.keys` would
 * surface precisely the local-only fields we must hide. The schema metadata
 * lists exactly the synced fields in declaration order — use it for Schema
 * instances and fall back to `Object.keys` for plain objects.
 */
function schemaFieldKeys(obj: any): string[] {
    if (Schema.isSchema(obj)) {
        return Object.keys(Metadata.getFields(obj.constructor));
    }
    return Object.keys(obj);
}

function isExpandable(value: any): boolean {
    if (value === null || value === undefined) { return false; }
    const valueType = typeof value;
    const isObject = valueType === 'object' && !(value instanceof Array);
    const hasForEach = valueType === 'object' && typeof value.forEach === 'function';
    const isArray = value instanceof Array;
    return isObject || isArray || hasForEach;
}

/** A value that can be patched in place (i.e. not undefined, not an object). */
function isPatchablePrimitive(value: any): boolean {
    if (value === null) { return true; }
    const t = typeof value;
    return t === 'string' || t === 'number' || t === 'boolean';
}

function getLabelColor(fieldName: any): string {
    return typeof fieldName === 'string' && fieldName.startsWith('"') ? VALUE_COLORS.string : KEY_COLOR;
}

interface DisplayState {
    isRoot: boolean;
    initialDisplay: string;
    initialIcon: string;
    rootClass: string;
}

function getDisplayState(depth: number, isPathExpanded: boolean): DisplayState {
    const isRoot = depth === 0;
    return {
        isRoot,
        initialDisplay: isRoot ? 'block' : (isPathExpanded ? 'block' : 'none'),
        initialIcon: (isRoot || isPathExpanded) ? '▼' : '▶',
        rootClass: isRoot ? ' data-root-node="true"' : '',
    };
}

function renderExpandButton(displayState: DisplayState, displayLabel: string, size: number | string | null): string {
    const cursor = displayState.isRoot ? 'default' : 'pointer';
    const onmouseover = displayState.isRoot ? '' : 'this.style.backgroundColor=\'rgba(255,255,255,0.05)\'';
    const onmouseout = displayState.isRoot ? '' : 'this.style.backgroundColor=\'transparent\'';

    let html = '<div data-expand-button' + displayState.rootClass + ' style="display: flex; align-items: center; cursor: ' + cursor + '; user-select: none; margin: 0; padding: 1px 0;" onmouseover="' + onmouseover + '" onmouseout="' + onmouseout + '">';
    html += '<span data-expand-icon style="margin-right: 4px; color: ' + PUNCTUATION_COLOR + '; font-size: 10px; width: 10px; display: inline-block; text-align: center; user-select: none;">' + displayState.initialIcon + '</span>';
    if (displayLabel) {
        html += '<span style="color: ' + getLabelColor(displayLabel) + ';">' + escapeHtml(String(displayLabel)) + '</span>';
    }
    if (size !== null && size !== undefined && size !== '?') {
        html += ' <span style="color: ' + PUNCTUATION_COLOR + ';">(' + size + ') </span>';
    }
    html += '</div>';
    return html;
}

interface FormattedPrimitive {
    text: string;
    color: string;
}

function formatPrimitive(value: any): FormattedPrimitive {
    if (value === null) { return { text: 'null', color: VALUE_COLORS.nullish }; }
    if (value === undefined) { return { text: 'undefined', color: VALUE_COLORS.nullish }; }
    switch (typeof value) {
        case 'string': return { text: '"' + value + '"', color: VALUE_COLORS.string };
        case 'number': return { text: String(value), color: VALUE_COLORS.number };
        case 'boolean': return { text: String(value), color: VALUE_COLORS.boolean };
        default: return { text: String(value), color: VALUE_COLORS.nullish };
    }
}

/**
 * Render a primitive value as a `<span>`. When `vk` ("<ownerId>|<key>") is
 * provided the span is tagged so {@link StateTreeView} can patch it in place.
 */
function primitiveSpan(value: any, vk: string | null): string {
    const formatted = formatPrimitive(value);
    const attr = (vk !== null) ? ' data-vk="' + escapeAttr(vk) + '" data-kind="value"' : '';
    return '<span' + attr + ' style="color: ' + formatted.color + ';">' + escapeHtml(formatted.text) + '</span>';
}
