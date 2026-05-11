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
   * Live room reference. Wired by the framework at room __init time,
   * AFTER the room's own construction. Accessing it during the plugin's
   * own constructor throws — use lifecycle hooks instead.
   *
   * Public read-only by convention so test code can swap it without
   * `as any`, but treat it as set-once in production.
   */
  public readonly room!: This;

  /**
   * Declarative message handlers — merged into the room's `messages` at
   * __init. Handlers can be either:
   *
   *  - arrow functions: `this` is the plugin instance (use `this.room.X`
   *    for room access; useful when you also need plugin state)
   *  - function expressions: `this` is the room (framework `.bind`s)
   *
   * Conflicts: if the room declares the same key, the room wins (the
   * plugin's handler is silently dropped — that's the documented escape
   * hatch for "use the plugin but override one message"). If TWO plugins
   * declare the same key, the framework throws at __init naming both.
   */
  messages?: Messages<This>;

  /** Optional per-hook ordering vs the room's own hook. */
  order?: RoomPluginOrder;

  // Lifecycle hooks — override any subset. Signatures match Room's so
  // subclasses can use the same parameter types they're used to.
  onCreate?(options: any): void | Promise<void>;
  onJoin?(client: Client, options?: any): void | Promise<void>;
  onLeave?(client: Client, code?: number): void | Promise<void>;
  onDispose?(): void | Promise<void>;
}

/**
 * Define the plugin record for a Room subclass. Each entry is a plugin
 * instance; the framework wires them at `__init` time and (lazily, on
 * the first construct of the class) computes the lifecycle/message
 * layout, caches it on the constructor, and installs hook wrappers on
 * the class prototype. Subsequent constructs reuse the cached layout.
 *
 * The `const T` modifier (TS 5.0+) preserves each value's literal class
 * type so `this.plugins.<key>.method()` autocompletes against the
 * specific plugin subclass rather than the base.
 *
 * Usage:
 *
 *   class MyRoom extends Room<{ state: MyState }> {
 *     plugins = definePlugins({
 *       chat:    new ChatPlugin({ historyLimit: 100 }),
 *       physics: new PhysicsPlugin<this>({ gravity: 12 }),
 *     });
 *   }
 *
 * Plugins that need typed access to the host room's state should
 * parameterize their own generic with `<this>` (e.g.
 * `LeaderboardsPlugin<this>` for plugins that read `room.state.X`).
 * `definePlugins` constrains values to `RoomPlugin<any>` here on
 * purpose — narrowing to `RoomPlugin<this>` would force every
 * non-generic plugin to be spelled `new X<this>(...)`, which adds noise
 * without adding safety.
 */
export function definePlugins<
  const T extends Record<string, RoomPlugin<any>>,
>(plugins: T): T {
  return plugins;
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
 * Precomputed plugin layout for a Room subclass — populated on the
 * first construction and cached on the constructor (`static
 * __pluginLayout`). The framework reads this on subsequent constructs
 * to skip the conflict-detection / hook-ordering work and just
 * materialize fresh plugin instances + wire their `.room` ref.
 *
 * Lifecycle hook wrappers are installed on the class prototype as part
 * of the same one-shot setup — see `installPluginHookWrappers`.
 *
 * @internal
 */
export interface PluginLayout {
  /** Per-hook participation: which plugin keys run before/after the room's own hook. */
  hooks: Record<PluginLifecycleKey, { before: string[]; after: string[] }>;
  /** Message key → plugin key. Conflict detection ran when this was built. */
  messageOwners: Map<string, string>;
}

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
  const entries = Object.entries(plugins);
  const hooks = {} as Record<PluginLifecycleKey, { before: string[]; after: string[] }>;
  let anyHook = false;

  for (const hook of PLUGIN_LIFECYCLE_KEYS) {
    const before: string[] = [];
    const after: string[] = [];
    for (const [pluginKey, plugin] of entries) {
      if (typeof (plugin as any)[hook] !== 'function') { continue; }
      const order = plugin.order?.[hook] ?? DEFAULT_PLUGIN_ORDER[hook];
      (order === 'before' ? before : after).push(pluginKey);
      anyHook = true;
    }
    hooks[hook] = { before, after };
  }

  const messageOwners = new Map<string, string>();
  for (const [pluginKey, plugin] of entries) {
    if (!plugin.messages) { continue; }
    for (const messageKey of Object.keys(plugin.messages)) {
      const prior = messageOwners.get(messageKey);
      if (prior !== undefined) {
        throw new Error(
          `[Room] message key "${messageKey}" declared by multiple plugins: ` +
          `"${prior}" and "${pluginKey}". Resolve by giving one of them a ` +
          `different key, or override on the room's own \`messages\`.`,
        );
      }
      messageOwners.set(messageKey, pluginKey);
    }
  }

  if (!anyHook && messageOwners.size === 0) { return null; }
  return { hooks, messageOwners };
}

/**
 * Install one wrapper per participating lifecycle hook on the Room
 * subclass's prototype. The wrapper closes over `before`/`after`
 * arrays of plugin KEYS (not refs) so it works for every instance of
 * the class — at call time it resolves the per-instance plugin via
 * `this.plugins[key]`.
 *
 * The "original" room hook (whatever sat on `ctor.prototype[hook]`
 * before this call — typically the user's `onJoin() {...}` method) is
 * captured in closure so the wrapper can still invoke it between the
 * before-plugins and the after-plugins.
 *
 * The constructor is typed structurally so this helper doesn't have
 * to import the concrete `Room` class (which would create a cycle).
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
    proto[hook] = async function (this: { plugins?: Record<string, RoomPlugin> }, ...args: any[]) {
      const plugins = this.plugins!;
      for (const k of before) {
        await ((plugins[k] as any)[hook] as Function).call(plugins[k], ...args);
      }
      let result;
      if (original) { result = await original.apply(this, args); }
      for (const k of after) {
        await ((plugins[k] as any)[hook] as Function).call(plugins[k], ...args);
      }
      return result;
    };
  }
}
