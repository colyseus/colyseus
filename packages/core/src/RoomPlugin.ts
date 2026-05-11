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
 *     plugins = definePlugins<this>({
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
 * Define the plugins record for a room with full per-key type
 * preservation. The `const T` modifier (TS 5.0+) keeps each value's
 * exact class type so `this.plugins.<key>.method()` autocompletes
 * against the specific plugin subclass rather than the base.
 *
 * Usage:
 *
 *   plugins = definePlugins<this>({
 *     chat:    new ChatPlugin({ historyLimit: 100 }),
 *     physics: new PhysicsPlugin({ gravity: 12 }),
 *   });
 *
 * Then `this.plugins.chat.getHistory()` and `this.plugins.physics.step(dt)`
 * are both typed against the specific plugin class.
 */
export function definePlugins<
  This extends Room,
  const T extends Record<string, RoomPlugin<This>>,
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
