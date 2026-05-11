/**
 * Microbenchmark: legacy per-instance plugin wiring vs the new
 * static-plugin layout-cached approach.
 *
 * Both implementations use the SAME plugin classes (3 plugins) with the
 * same shape:
 *  - each declares 2 message handlers
 *  - each declares 2 lifecycle hooks (onCreate + onJoin or onLeave/dispose)
 *
 * We deliberately strip the rest of the Room class away — autoDispose
 * timers, Object.defineProperty setters, state serializer, etc. — so
 * the numbers reflect ONLY plugin wiring.
 *
 * Run with:
 *   node --experimental-strip-types benchmark/plugin-wiring-bench.ts
 */

// ---------------------------------------------------------------------------
// Plugin shapes (shared by both harnesses)
// ---------------------------------------------------------------------------

const LIFECYCLE_KEYS = ['onCreate', 'onJoin', 'onLeave', 'onDispose'] as const;
type LifecycleKey = (typeof LIFECYCLE_KEYS)[number];

interface Plugin {
  room?: any;
  messages?: Record<string, (...args: any[]) => any>;
  order?: Partial<Record<LifecycleKey, 'before' | 'after'>>;
  onCreate?(opts: any): void | Promise<void>;
  onJoin?(client: any): void | Promise<void>;
  onLeave?(client: any): void | Promise<void>;
  onDispose?(): void | Promise<void>;
}

class AnalyticsPlugin implements Plugin {
  room?: any;
  messages = {
    track: function() {},
    flush: function() {},
  };
  onCreate() {}
  onJoin() {}
}

class CloudSavesPlugin implements Plugin {
  room?: any;
  messages = {
    save: function() {},
    load: function() {},
  };
  onJoin() {}
  onLeave() {}
}

class LeaderboardsPlugin implements Plugin {
  room?: any;
  messages = {
    submit: function() {},
    top: function() {},
  };
  onCreate() {}
  onDispose() {}
}

// ---------------------------------------------------------------------------
// LEGACY: per-instance wiring (mirrors the old #_wirePlugins)
// ---------------------------------------------------------------------------

const DEFAULT_ORDER: Record<LifecycleKey, 'before' | 'after'> = {
  onCreate: 'before',
  onJoin:   'before',
  onLeave:  'after',
  onDispose:'after',
};

class LegacyRoom {
  plugins: Record<string, Plugin>;
  messages: Record<string, (...args: any[]) => any> = {};

  constructor() {
    // Plugins instantiated per construct (instance-field-initializer pattern)
    this.plugins = {
      analytics: new AnalyticsPlugin(),
      saves:     new CloudSavesPlugin(),
      ranked:    new LeaderboardsPlugin(),
    };
    this.wirePlugins();
  }

  // Mirrors the original #_wirePlugins from before the refactor.
  private wirePlugins() {
    const pluginEntries = Object.entries(this.plugins);

    // 1. Inject room reference
    for (const [, plugin] of pluginEntries) {
      plugin.room = this;
    }

    // 2. Merge plugin messages w/ conflict detection
    const ownedBy = new Map<string, string>();
    for (const [pluginKey, plugin] of pluginEntries) {
      if (!plugin.messages) continue;
      for (const [messageKey, handler] of Object.entries(plugin.messages)) {
        if (this.messages[messageKey]) continue;
        const prior = ownedBy.get(messageKey);
        if (prior !== undefined) {
          throw new Error(
            `message key "${messageKey}" declared by multiple plugins: "${prior}" and "${pluginKey}"`,
          );
        }
        ownedBy.set(messageKey, pluginKey);
        this.messages[messageKey] = handler;
      }
    }

    // 3. Compose lifecycle hooks — create per-instance closures
    for (const hook of LIFECYCLE_KEYS) {
      const before: Plugin[] = [];
      const after: Plugin[] = [];
      for (const [, plugin] of pluginEntries) {
        if (typeof plugin[hook] !== 'function') continue;
        const order = plugin.order?.[hook] ?? DEFAULT_ORDER[hook];
        (order === 'before' ? before : after).push(plugin);
      }
      if (before.length === 0 && after.length === 0) continue;
      const original = (this as any)[hook]?.bind(this);
      (this as any)[hook] = async function (this: LegacyRoom, ...args: any[]) {
        for (const p of before) await (p[hook] as Function).call(p, ...args);
        let r;
        if (original) r = await original(...args);
        for (const p of after) await (p[hook] as Function).call(p, ...args);
        return r;
      };
    }

    Object.freeze(this.plugins);
  }
}

// ---------------------------------------------------------------------------
// STATIC: cached layout + prototype-installed wrappers (the new approach)
// ---------------------------------------------------------------------------

interface PluginLayout {
  hooks: Record<LifecycleKey, { before: string[]; after: string[] }>;
  messageOwners: Map<string, string>;
}

function invokeFactories(factories: Record<string, () => Plugin>) {
  const out: Record<string, Plugin> = {};
  for (const [k, f] of Object.entries(factories)) out[k] = f();
  return out;
}

function computeLayout(samples: Record<string, Plugin>): PluginLayout | null {
  const entries = Object.entries(samples);
  const hooks = {} as Record<LifecycleKey, { before: string[]; after: string[] }>;
  let any = false;
  for (const hook of LIFECYCLE_KEYS) {
    const before: string[] = [];
    const after: string[] = [];
    for (const [k, s] of entries) {
      if (typeof s[hook] !== 'function') continue;
      const order = s.order?.[hook] ?? DEFAULT_ORDER[hook];
      (order === 'before' ? before : after).push(k);
      any = true;
    }
    hooks[hook] = { before, after };
  }
  const messageOwners = new Map<string, string>();
  for (const [k, s] of entries) {
    if (!s.messages) continue;
    for (const mk of Object.keys(s.messages)) {
      const prior = messageOwners.get(mk);
      if (prior !== undefined) throw new Error(`conflict on ${mk}`);
      messageOwners.set(mk, k);
    }
  }
  if (!any && messageOwners.size === 0) return null;
  return { hooks, messageOwners };
}

function installWrappers(ctor: any, layout: PluginLayout | null) {
  if (!layout) return;
  for (const hook of LIFECYCLE_KEYS) {
    const { before, after } = layout.hooks[hook];
    if (before.length === 0 && after.length === 0) continue;
    const original = ctor.prototype[hook] as Function | undefined;
    ctor.prototype[hook] = async function (this: StaticRoom, ...args: any[]) {
      const ps = this.plugins!;
      for (const k of before) await (ps[k][hook] as Function).call(ps[k], ...args);
      let r;
      if (original) r = await original.apply(this, args);
      for (const k of after) await (ps[k][hook] as Function).call(ps[k], ...args);
      return r;
    };
  }
}

class StaticRoom {
  static plugins = {
    analytics: () => new AnalyticsPlugin(),
    saves:     () => new CloudSavesPlugin(),
    ranked:    () => new LeaderboardsPlugin(),
  };
  static __pluginLayout?: PluginLayout | null;

  plugins?: Record<string, Plugin>;
  messages: Record<string, (...args: any[]) => any> = {};

  constructor() {
    const ctor = this.constructor as typeof StaticRoom;
    const factories = ctor.plugins;

    let layout: PluginLayout | null | undefined;
    let instances: Record<string, Plugin>;

    if (Object.prototype.hasOwnProperty.call(ctor, '__pluginLayout')) {
      layout = ctor.__pluginLayout;
    }
    if (layout === undefined) {
      instances = invokeFactories(factories);
      layout = computeLayout(instances);
      installWrappers(ctor, layout);
      ctor.__pluginLayout = layout;
    } else {
      instances = invokeFactories(factories);
    }

    for (const p of Object.values(instances)) p.room = this;

    if (layout && layout.messageOwners.size > 0) {
      for (const [mk, pk] of layout.messageOwners) {
        if (this.messages[mk]) continue;
        const h = instances[pk].messages?.[mk];
        if (h) this.messages[mk] = h;
      }
    }
    this.plugins = Object.freeze(instances);
  }
}

// ---------------------------------------------------------------------------
// INSTANCE + CACHED LAYOUT: same as the static branch's optimization, but
// plugins are declared as an instance-field initializer (no `static`,
// no `declare plugins:`). The layout is still cached on the constructor.
// ---------------------------------------------------------------------------

class InstanceCachedRoom {
  static __pluginLayout?: PluginLayout | null;
  plugins: Record<string, Plugin>;
  messages: Record<string, (...args: any[]) => any> = {};

  constructor() {
    // Instance-level plugin record — declared inline.
    this.plugins = {
      analytics: new AnalyticsPlugin(),
      saves:     new CloudSavesPlugin(),
      ranked:    new LeaderboardsPlugin(),
    };

    const ctor = this.constructor as typeof InstanceCachedRoom;
    let layout: PluginLayout | null | undefined;
    if (Object.prototype.hasOwnProperty.call(ctor, '__pluginLayout')) {
      layout = ctor.__pluginLayout;
    }
    if (layout === undefined) {
      // First construct: compute layout from this instance's plugins,
      // install wrappers on the prototype, cache.
      layout = computeLayout(this.plugins);
      installWrappers(ctor, layout);
      ctor.__pluginLayout = layout;
    }

    for (const p of Object.values(this.plugins)) p.room = this;

    if (layout && layout.messageOwners.size > 0) {
      for (const [mk, pk] of layout.messageOwners) {
        if (this.messages[mk]) continue;
        const h = this.plugins[pk].messages?.[mk];
        if (h) this.messages[mk] = h;
      }
    }
    Object.freeze(this.plugins);
  }
}

// ---------------------------------------------------------------------------
// SHARED: singleton plugin instances + WeakMap<Room, State> internally
// ---------------------------------------------------------------------------
// Plugins are instantiated ONCE per class (at definePlugins time) and
// the same instances are reused across every room. To preserve per-room
// state isolation, each plugin keeps its state in a WeakMap keyed by
// the host room. The framework's per-construct wiring drops to a
// single reference assignment.

class AnalyticsPluginShared implements Plugin {
  private state = new WeakMap<object, { events: number }>();
  messages = { track: function() {}, flush: function() {} };
  onCreate(this: any) { (this as any).analyticsState ??= { events: 0 }; }
  onJoin(this: any)   { /* no-op */ }
}
class CloudSavesPluginShared implements Plugin {
  messages = { save: function() {}, load: function() {} };
  onJoin(this: any)  {}
  onLeave(this: any) {}
}
class LeaderboardsPluginShared implements Plugin {
  messages = { submit: function() {}, top: function() {} };
  onCreate(this: any)  {}
  onDispose(this: any) {}
}

// Shared singletons + layout precomputed once.
const sharedFactories = {
  analytics: new AnalyticsPluginShared(),
  saves:     new CloudSavesPluginShared(),
  ranked:    new LeaderboardsPluginShared(),
} as const;
const sharedLayout = computeLayout(sharedFactories as any);
// Pre-merge messages once (all instances of SharedRoom see the same handler refs).
const sharedMessages: Record<string, (...args: any[]) => any> = {};
if (sharedLayout) {
  for (const [mk, pk] of sharedLayout.messageOwners) {
    const h = (sharedFactories as any)[pk].messages?.[mk];
    if (h) sharedMessages[mk] = h;
  }
}

class SharedRoom {
  // Same singleton record on every instance. No `.room` to set since
  // plugins look up per-room state via WeakMap keyed by `this`.
  plugins = sharedFactories;
  messages = sharedMessages;

  // Lifecycle wrappers installed once on the prototype below.
}
installWrappers(SharedRoom, sharedLayout);

// ---------------------------------------------------------------------------
// Bench
// ---------------------------------------------------------------------------

function bench(label: string, run: () => void, iters: number) {
  // Warmup
  for (let i = 0; i < Math.min(iters / 10, 10_000); i++) run();
  // Force GC if exposed
  if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) run();
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1_000_000;
  const nsPerOp = Number(t1 - t0) / iters;
  console.log(
    `${label.padEnd(24)} ${iters.toLocaleString().padStart(10)} iters  ` +
    `${ms.toFixed(2).padStart(8)} ms total  ` +
    `${nsPerOp.toFixed(0).padStart(6)} ns/room  ` +
    `${Math.round(iters / (ms / 1000)).toLocaleString().padStart(12)} rooms/s`,
  );
}

const ITERS = 200_000;
console.log(`\nplugin wiring microbenchmark — ${ITERS.toLocaleString()} iters each\n`);
console.log('legacy   = per-instance wirePlugins (closures, conflict detect, hook compose)');
console.log('static   = static plugins + cached layout + prototype wrappers');
console.log('instance = instance plugins + cached layout + prototype wrappers');
console.log('shared   = singleton plugin instances, WeakMap for per-room state');
console.log('');

// Run each scenario twice so the JIT settles
for (let pass = 1; pass <= 2; pass++) {
  console.log(`-- pass ${pass} --`);
  bench('legacy (per-instance)',       () => { new LegacyRoom(); },         ITERS);
  bench('static (cached layout)',      () => { new StaticRoom(); },         ITERS);
  bench('instance + cached layout',    () => { new InstanceCachedRoom(); }, ITERS);
  bench('shared (singletons)',         () => { new SharedRoom(); },         ITERS);
  console.log('');
}
