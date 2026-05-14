/**
 * Room plugins.
 *
 * A plugin is a composable extension to a Room — it can declare message
 * handlers, attach lifecycle hooks, and expose public methods that the
 * room can call (`this.plugins.<key>.someMethod()`). The framework
 * instantiates one plugin per room, sets `this.room` after the room is
 * constructed, then merges the plugin's `messages` with the room's own
 * and wires its lifecycle hooks alongside the room's.
 *
 * Example: a tiny chat plugin contributing a single message handler:
 *
 *   class ChatPlugin extends RoomPlugin {
 *     private history: string[] = [];
 *     constructor(private opts: { historyLimit: number }) { super(); }
 *
 *     messages = {
 *       chat: (client: Client, msg: { text: string }) => {
 *         this.history.push(msg.text);
 *         if (this.history.length > this.opts.historyLimit) this.history.shift();
 *         this.room.broadcast('chat', { from: client.userId, text: msg.text });
 *       },
 *     };
 *
 *     // Public — callable as `this.plugins.chat.getHistory()` from the room
 *     getHistory(): readonly string[] { return this.history; }
 *   }
 *
 * Use via `definePlugins`:
 *
 *   class MyRoom extends Room<{ state: MyState }> {
 *     plugins = definePlugins({
 *       chat: new ChatPlugin({ historyLimit: 100 }),
 *     });
 *   }
 */
import type { Room } from './Room.ts';
import type { Client } from './Transport.ts';
import type { Messages } from '@colyseus/shared-types';

/**
 * Ordering hint for a plugin's lifecycle hook relative to the room's own
 * hook. Sensible per-hook defaults are applied when omitted (see
 * `Room.__init` for the exact ordering policy).
 *
 *   onCreate  / onJoin    → plugins run BEFORE room (guards + setup)
 *   onLeave   / onDispose → plugins run AFTER room (capture final state)
 */
export interface RoomPluginOrder {
  onCreate?:  'before' | 'after';
  onJoin?:    'before' | 'after';
  onLeave?:   'before' | 'after';
  onDispose?: 'before' | 'after';
}

/**
 * Base class for room plugins. Subclass to define a plugin; the framework
 * sets `this.room` after the host room is fully constructed.
 *
 * Don't access `this.room` from the plugin's constructor — it hasn't been
 * wired yet. Everything room-dependent goes in `onCreate` / `onJoin` /
 * etc. or in public methods that are called from the room post-init.
 *
 * @typeParam This - The Room subclass this plugin is attached to. Narrow
 *   for schema-driven plugins that need a specific state shape, e.g.
 *   `class PhysicsPlugin extends RoomPlugin<Room<{ state: PhysicsContract }>>`.
 */
export abstract class RoomPlugin<This extends Room = Room> {
  /**
   * Live room reference. Wired by the framework at __init, AFTER the
   * room's own construction — accessing it from the plugin's
   * constructor throws.
   */
  protected readonly room!: This;

  /**
   * Canonical key for the plugin when registered via `definePlugins([...])`.
   * Declared on the subclass with `as const` so the literal type flows
   * into `room.plugins.<key>`:
   *
   *   class ChatPlugin extends RoomPlugin {
   *     readonly pluginName = 'chat' as const;
   *   }
   *
   * Optional under the keyed-record form (`definePlugins({ chat: ... })`),
   * required under the array form. Must stay `public` so `extends` /
   * `keyof` can see the literal — those are blind to protected from
   * outside the class. End-user autocomplete hides it via `Omit` in
   * `definePlugins`'s return type.
   *
   * For multi-instance use, accept the name at construction:
   *
   *   readonly pluginName: string;
   *   constructor(name = 'chat') { super(); this.pluginName = name; }
   */
  readonly pluginName?: string;

  /**
   * Declarative message handlers — merged into the room's `messages` at
   * __init. Conflict against the room's own key: room wins. Conflict
   * between two plugins: throws at __init.
   */
  protected messages?: Messages<This>;

  /** Optional per-hook ordering vs the room's own hook. */
  protected order?: RoomPluginOrder;

  // Lifecycle hooks — override any subset. `protected` so they don't
  // leak into `this.plugins.<key>.onJoin(...)` autocomplete; subclass
  // overrides must keep `protected` (TS widens to public silently
  // otherwise).
  protected onCreate?(options: any): void | Promise<void>;
  protected onJoin?(client: Client, options?: any): void | Promise<void>;
  protected onLeave?(client: Client, code?: number): void | Promise<void>;
  protected onDispose?(): void | Promise<void>;
}

/**
 * Plugin-class constructor type used by the `dependencies` static
 * declaration. Constrained to zero-arg constructors because the
 * framework auto-instantiates missing dependencies with no
 * configuration — plugins that need options can't be auto-included
 * and must be registered explicitly in `definePlugins({...})`.
 */
export type RoomPluginClass = new () => RoomPlugin<any>;

/**
 * Static `dependencies` declaration. List other plugin classes this
 * plugin needs alongside it; the framework auto-instantiates any
 * missing ones at room construction time. Transitive deps are
 * resolved recursively. Cycles throw at class-init.
 *
 * Example:
 *   class UniqueSessionPlugin extends RoomPlugin {
 *     static dependencies: PluginDependencies = [TrackUserSessionsPlugin];
 *   }
 */
export type PluginDependencies = ReadonlyArray<RoomPluginClass>;

/**
 * Define a Room's plugin record. The framework wires plugins at
 * `__init` — first construct of the class computes the layout
 * (cached on the constructor) and installs hook wrappers on the
 * prototype. The `const T` modifier preserves literal types so
 * `this.plugins.<key>.method()` autocompletes against each plugin's
 * specific subclass.
 */
// Pulls each plugin's `pluginName` literal as the record key. Subclass
// must narrow with `as const` — plain `string` resolves to `never`
// and the entry is dropped (callers see a TS error on
// `plugins.<thatKey>`).
type ExtractPluginName<P> = P extends { pluginName: infer K }
  ? (K extends string ? K : never)
  : never;

/** Hide `pluginName` from end-user autocomplete on `this.plugins.<key>`. */
type PluginPublicSurface<P> = Omit<P, 'pluginName'>;

type PluginsArrayToRecord<T extends readonly RoomPlugin<any>[]> = {
  [P in T[number] as ExtractPluginName<P>]: PluginPublicSurface<P>;
};

/**
 * Array form (recommended). Each plugin declares its own canonical
 * key via `readonly pluginName = '...' as const`; the framework
 * turns the array into a typed record so `plugins.<pluginName>`
 * autocompletes the right instance type.
 *
 *   class GameRoom extends Room {
 *     plugins = definePlugins([
 *       new ChatPlugin(),                    // pluginName: 'chat'
 *       new UniqueSessionPlugin({ max: 1 }), // pluginName: 'uniqueSession'
 *     ]);
 *   }
 *   this.plugins.chat.send('hi');
 *
 * Throws at runtime if any plugin is missing `pluginName` or if two
 * plugins resolve to the same key.
 */
export function definePlugins<const T extends readonly RoomPlugin<any>[]>(
  plugins: T,
): PluginsArrayToRecord<T>;

/**
 * Record form (legacy / multi-instance escape hatch). The caller
 * chooses the key per-room. Useful when registering two instances of
 * the same plugin class without configuring `pluginName` per
 * instance — e.g. `{ adminChat: new ChatPlugin(), playerChat: new ChatPlugin() }`.
 */
export function definePlugins<const T extends Record<string, RoomPlugin<any>>>(
  plugins: T,
): { [K in keyof T]: PluginPublicSurface<T[K]> };

export function definePlugins(plugins: any): any {
  if (!Array.isArray(plugins)) { return plugins; }
  const out: Record<string, RoomPlugin> = {};
  for (const p of plugins) {
    const key = p['pluginName'];
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error(
        `[Room] plugin ${p.constructor.name} is missing a 'pluginName' field. ` +
        `Declare \`readonly pluginName = '<key>' as const\` on the class, ` +
        `or register it via the keyed-record form \`definePlugins({ <key>: <plugin> })\`.`,
      );
    }
    if (out[key]) {
      throw new Error(
        `[Room] two plugins resolve to pluginName "${key}". Configure one of ` +
        `them via constructor argument, or use the keyed-record form to disambiguate.`,
      );
    }
    out[key] = p;
  }
  return out;
}

/**
 * Lifecycle hook keys recognized by the framework — used internally to
 * separate "framework-recognized methods" from "user-defined public
 * methods" when wiring a plugin into a room. Exported for the test
 * harness; downstream code should not need it.
 */
export const PLUGIN_LIFECYCLE_KEYS = ['onCreate', 'onJoin', 'onLeave', 'onDispose'] as const;
export type PluginLifecycleKey = (typeof PLUGIN_LIFECYCLE_KEYS)[number];

/**
 * Test helper — attach a stub or fake room to a plugin so its methods
 * and lifecycle hooks can be exercised in isolation without spinning up
 * a real Colyseus server.
 *
 *   const plugin = new ChatPlugin({ historyLimit: 5 });
 *   const room = attachToTestRoom(plugin, { broadcast: sinon.spy() });
 *   await plugin.messages!.chat!.call(plugin, { userId: 'u1' }, { text: 'hi' });
 *
 * The second arg is shallow-merged onto the stub so tests only declare
 * the room properties they actually exercise. Returns the room stub for
 * post-call assertions.
 */
export function attachToTestRoom<This extends Room, R extends Partial<This>>(
  plugin: RoomPlugin<This>,
  roomStub: R = {} as R,
): R {
  (plugin as any).room = roomStub;
  return roomStub;
}

// ---------------------------------------------------------------------------
// Layout machinery — used by Room.__init to set plugins up once per class.
// Lives in this file (rather than Room.ts) so the plugin-related types and
// helpers stay co-located. These are framework internals; callers outside
// `@colyseus/core` should not depend on them.
// ---------------------------------------------------------------------------

/**
 * Precomputed plugin layout for a Room subclass — populated on first
 * construct, cached on the constructor. Hook wrappers are installed
 * on the prototype in the same pass (see `installPluginHookWrappers`).
 *
 * @internal
 */
export interface PluginLayout {
  /** Per-hook participation: which plugin keys run before/after the room's own hook. */
  hooks: Record<PluginLifecycleKey, { before: string[]; after: string[] }>;
  /** Message key → plugin key. Conflict detection ran when this was built. */
  messageOwners: Map<string, string>;
  /** Sentinel-keyed plugin classes to instantiate per room. */
  autoDeps: Array<{ key: string; ctor: RoomPluginClass }>;
}

/** Sentinel prefix for framework-instantiated deps. The colon prevents
 *  collisions with any JS identifier the user could use as a key. */
const DEP_KEY_PREFIX = '__dep:';

/**
 * Default before/after policy for lifecycle hooks vs the room's own
 * hook. Plugins can override per-hook via the `order` field on the
 * plugin instance.
 *
 *   onCreate / onJoin    → plugins run BEFORE room (guards + setup)
 *   onLeave  / onDispose → plugins run AFTER room (capture final state)
 *
 * @internal
 */
export const DEFAULT_PLUGIN_ORDER: Record<PluginLifecycleKey, 'before' | 'after'> = {
  onCreate:  'before',
  onJoin:    'before',
  onLeave:   'after',
  onDispose: 'after',
};

/**
 * Walk the room's plugin instances and produce the lifecycle + message
 * layout for the Room class. Called once per Room subclass — on the
 * first construct — and the result is cached on the constructor. Throws
 * on duplicate message keys (named both plugin keys) so the failure is
 * visible at class-init rather than at first message dispatch.
 *
 * Returns `null` when no plugins participate in any hook AND none
 * declare a message — distinguishes "computed, nothing to do" from
 * "not computed yet" in the `__pluginLayout` cache.
 *
 * @internal
 */
export function computePluginLayout(plugins: Record<string, RoomPlugin>): PluginLayout | null {
  // Resolve `static dependencies` closures over the user's record.
  // Returns an expanded list (user + auto-deps), the auto-dep
  // class table for per-room instantiation, and a unified view of
  // entries to iterate when computing hooks / message owners.
  const resolved = resolveDependencies(plugins);

  const hooks = {} as Record<PluginLifecycleKey, { before: string[]; after: string[] }>;
  let anyHook = false;

  for (const hook of PLUGIN_LIFECYCLE_KEYS) {
    const before: string[] = [];
    const after: string[] = [];
    for (const { key, plugin } of resolved.entries) {
      if (typeof plugin[hook] !== 'function') { continue; }
      // Bracket access — `order` and `messages` are protected; TS
      // skips visibility checks on indexed access.
      const order = plugin['order']?.[hook] ?? DEFAULT_PLUGIN_ORDER[hook];
      (order === 'before' ? before : after).push(key);
      anyHook = true;
    }
    hooks[hook] = { before, after };
  }

  const messageOwners = new Map<string, string>();
  for (const { key, plugin } of resolved.entries) {
    const messages = plugin['messages'];
    if (!messages) { continue; }
    for (const messageKey of Object.keys(messages)) {
      const prior = messageOwners.get(messageKey);
      if (prior !== undefined) {
        throw new Error(
          `[Room] message key "${messageKey}" declared by multiple plugins: ` +
          `"${prior}" and "${key}". Resolve by giving one of them a ` +
          `different key, or override on the room's own \`messages\`.`,
        );
      }
      messageOwners.set(messageKey, key);
    }
  }

  if (!anyHook && messageOwners.size === 0 && resolved.autoDeps.length === 0) { return null; }
  return { hooks, messageOwners, autoDeps: resolved.autoDeps };
}

/**
 * Walk every plugin's `static dependencies` recursively, instantiating
 * missing classes (zero-arg only). Throws on cycles. Auto-deps are
 * keyed `__dep:<ClassName>` in the returned entries.
 */
function resolveDependencies(plugins: Record<string, RoomPlugin>): {
  entries: Array<{ key: string; plugin: RoomPlugin }>;
  autoDeps: Array<{ key: string; ctor: RoomPluginClass }>;
} {
  const entries: Array<{ key: string; plugin: RoomPlugin }> = [];
  for (const [key, plugin] of Object.entries(plugins)) {
    entries.push({ key, plugin });
  }

  const present = new Set<RoomPluginClass>();
  for (const { plugin } of entries) {
    present.add(plugin.constructor as RoomPluginClass);
  }

  const autoDeps: Array<{ key: string; ctor: RoomPluginClass }> = [];
  const visiting = new Set<RoomPluginClass>();
  const path: string[] = [];

  function walk(depCtor: RoomPluginClass): void {
    if (present.has(depCtor)) { return; }
    if (visiting.has(depCtor)) {
      const cycle = [...path, depCtor.name].join(' → ');
      throw new Error(`[Room] plugin dependency cycle: ${cycle}`);
    }
    visiting.add(depCtor);
    path.push(depCtor.name);

    // Recurse into deeper deps first → topological order in `entries`.
    const deeper = (depCtor as any).dependencies as PluginDependencies | undefined;
    if (Array.isArray(deeper)) {
      for (const inner of deeper) { walk(inner); }
    }

    let instance: RoomPlugin;
    try { instance = new depCtor(); }
    catch (err: any) {
      throw new Error(
        `[Room] auto-included plugin "${depCtor.name}" must be ` +
        `constructible with no arguments. If it needs options, ` +
        `register it explicitly in definePlugins({...}). ` +
        `(cause: ${err?.message ?? err})`,
      );
    }
    const key = DEP_KEY_PREFIX + depCtor.name;
    entries.push({ key, plugin: instance });
    autoDeps.push({ key, ctor: depCtor });
    present.add(depCtor);

    visiting.delete(depCtor);
    path.pop();
  }

  // Snapshot before mutating — transitive deps are handled recursively
  // inside `walk()`.
  const userEntriesSnapshot = entries.slice();
  for (const { plugin } of userEntriesSnapshot) {
    const deps = (plugin.constructor as any).dependencies as PluginDependencies | undefined;
    if (!Array.isArray(deps)) { continue; }
    for (const depCtor of deps) { walk(depCtor); }
  }

  return { entries, autoDeps };
}

/**
 * Install one wrapper per participating hook on the Room subclass's
 * prototype. The wrapper closes over plugin KEYS (resolved to refs at
 * call time) and invokes the captured original room hook between the
 * before/after plugin runs.
 *
 * @internal
 */
export function installPluginHookWrappers(
  ctor: { prototype: any },
  layout: PluginLayout | null,
): void {
  if (layout === null) { return; }
  const proto = ctor.prototype;
  for (const hook of PLUGIN_LIFECYCLE_KEYS) {
    const { before, after } = layout.hooks[hook];
    if (before.length === 0 && after.length === 0) { continue; }

    const original = proto[hook] as Function | undefined;
    proto[hook] = async function (
      this: { plugins?: Record<string, RoomPlugin>; _autoPlugins?: Record<string, RoomPlugin> },
      ...args: any[]
    ) {
      // User plugins live on `this.plugins`, auto-deps (sentinel-keyed)
      // on `this._autoPlugins` — kept separate so user types stay clean.
      const lookup = (k: string): RoomPlugin =>
        (k.startsWith(DEP_KEY_PREFIX) ? this._autoPlugins![k] : this.plugins![k]);
      for (const k of before) {
        const p = lookup(k);
        await (p[hook] as Function).call(p, ...args);
      }
      let result: unknown;
      if (original) { result = await original.apply(this, args); }
      for (const k of after) {
        const p = lookup(k);
        await (p[hook] as Function).call(p, ...args);
      }
      return result;
    };
  }
}

/** Structural shape used by `setupRoomPlugins` — avoids a Room import
 *  so the dependency graph stays one-way (Room → RoomPlugin). */
interface RoomPluginHost {
  plugins?: Record<string, RoomPlugin<any>>;
  _autoPlugins?: Record<string, RoomPlugin<any>>;
  messages?: Record<string, Function> | any;
  constructor: { __pluginLayout?: PluginLayout | null; prototype: any };
}

/**
 * Wire a Room instance's plugins. Once-per-class layout (hook
 * participation, message owners, dep resolution) is cached on the
 * constructor; per-instance work attaches `room` refs, instantiates
 * auto-deps, and merges plugin messages.
 *
 * @internal
 */
export function setupRoomPlugins(room: RoomPluginHost): void {
  const plugins = room.plugins!;
  const layout = resolveOrComputeLayout(room.constructor, plugins);

  attachRoomReference(room, plugins);

  if (layout && layout.autoDeps.length > 0) {
    room._autoPlugins = instantiateAutoDeps(room, layout);
  }

  if (layout && layout.messageOwners.size > 0) {
    mergePluginMessages(room, layout);
  }

  Object.freeze(plugins);
  if (room._autoPlugins) { Object.freeze(room._autoPlugins); }
}

/**
 * Read cached layout for this subclass, or compute + install on
 * first construct. `hasOwnProperty` so a subclass that redeclares
 * `plugins` doesn't inherit the parent's wrapping.
 */
function resolveOrComputeLayout(
  ctor: RoomPluginHost['constructor'],
  plugins: Record<string, RoomPlugin>,
): PluginLayout | null | undefined {
  if (Object.prototype.hasOwnProperty.call(ctor, '__pluginLayout')) {
    return ctor.__pluginLayout;
  }
  const layout = computePluginLayout(plugins);
  installPluginHookWrappers(ctor, layout);
  ctor.__pluginLayout = layout;
  return layout;
}

/** Wire `plugin.room = room` on every user-explicit plugin. */
function attachRoomReference(
  room: RoomPluginHost,
  plugins: Record<string, RoomPlugin>,
): void {
  for (const plugin of Object.values(plugins)) {
    (plugin as any).room = room;
  }
}

/**
 * Build `_autoPlugins` — one fresh instance per `static dependencies`
 * entry. Kept separate from `room.plugins` so sentinel keys
 * (`__dep:<ClassName>`) don't leak into the user's typed view.
 */
function instantiateAutoDeps(
  room: RoomPluginHost,
  layout: PluginLayout,
): Record<string, RoomPlugin> {
  const auto: Record<string, RoomPlugin> = {};
  for (const { key, ctor: depCtor } of layout.autoDeps) {
    const instance = new depCtor();
    (instance as any).room = room;
    auto[key] = instance;
  }
  return auto;
}

/**
 * Copy plugin message handlers into `room.messages` (room's own key
 * wins; plugin-vs-plugin conflicts already threw at layout time).
 */
function mergePluginMessages(
  room: RoomPluginHost,
  layout: PluginLayout,
): void {
  const plugins = room.plugins!;
  for (const [messageKey, pluginKey] of layout.messageOwners) {
    if (room.messages?.[messageKey]) { continue; }
    const source = pluginKey.startsWith(DEP_KEY_PREFIX)
      ? room._autoPlugins![pluginKey]
      : plugins[pluginKey];
    const handler = source['messages']?.[messageKey];
    if (handler !== undefined) {
      (room.messages ??= {} as any)[messageKey] = handler;
    }
  }
}
