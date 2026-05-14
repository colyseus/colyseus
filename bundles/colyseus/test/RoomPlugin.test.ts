import assert from 'assert';
import { Room, RoomPlugin, definePlugins, attachToTestRoom } from '@colyseus/core';

/**
 * Phase 1 unit tests for the RoomPlugin wiring inside Room.
 *
 * We exercise the wiring directly instead of spinning up a server:
 *   - declare a Room subclass with `plugins = definePlugins({...})`
 *   - call the private `__init()` to trigger the wiring
 *   - assert side effects (lifecycle composition, message merge, frozen, etc.)
 *
 * The plugin classes here are tiny stand-ins — not meant for production
 * use; they're shaped to verify framework behavior.
 *
 * NOTE: Each `describe`/`it` defines a FRESH Room subclass so the
 * per-class layout cache (`Room.__pluginLayout` installed on the
 * constructor) doesn't bleed between tests.
 */

// Test seam: __init is private; expose it via cast.
const runInit = (room: any) => room.__init();

describe('RoomPlugin core plumbing', () => {

  describe('room reference injection', () => {
    it('sets `room` on each plugin during __init', () => {
      class P extends RoomPlugin { }
      const p = new P();
      class R extends Room {
        plugins = definePlugins({ p });
      }
      const room = new R();
      assert.equal(p['room'], undefined, 'room should not be set before __init');
      runInit(room);
      assert.strictEqual(p['room'], room, 'room should point at the host after __init');
    });

    it('exposes attachToTestRoom for isolated unit tests', () => {
      class P extends RoomPlugin {
        ping() { return (this.room as any).pinged = true; }
      }
      const p = new P();
      const stub: any = {};
      attachToTestRoom(p, stub);
      p.ping();
      assert.equal(stub.pinged, true);
    });
  });

  describe('message merge', () => {
    it('merges plugin messages into the room', () => {
      class P extends RoomPlugin {
        messages = { ping: function() { /* noop */ } };
      }
      class R extends Room {
        plugins = definePlugins({ p: new P() });
      }
      const room = new R();
      runInit(room);
      assert.ok(room.messages, 'messages should be populated');
      assert.ok((room.messages as any).ping, 'ping handler from plugin');
    });

    it('room.messages key wins over a plugin declaring the same key', () => {
      class P extends RoomPlugin {
        messages = { collide: function() { return 'plugin'; } };
      }
      class R extends Room {
        messages: any = { collide: function() { return 'room'; } };
        plugins = definePlugins({ p: new P() });
      }
      const room = new R();
      runInit(room);
      // Room's handler should remain — plugin's was dropped.
      assert.equal((room.messages as any).collide(), 'room');
    });

    it('throws when two plugins declare the same message key', () => {
      class A extends RoomPlugin { messages = { collide: function() {} }; }
      class B extends RoomPlugin { messages = { collide: function() {} }; }
      class R extends Room {
        plugins = definePlugins({ a: new A(), b: new B() });
      }
      const room = new R();
      assert.throws(() => runInit(room), /message key "collide" declared by multiple plugins.*"a".*"b"/);
    });
  });

  describe('lifecycle composition', () => {
    it('runs onJoin: plugins before room (default order)', async () => {
      const order: string[] = [];
      class P extends RoomPlugin { onJoin() { order.push('plugin'); } }
      class R extends Room {
        plugins = definePlugins({ p: new P() });
        onJoin() { order.push('room'); }
      }
      const room = new R();
      runInit(room);
      await (room as any).onJoin({} as any);
      assert.deepEqual(order, ['plugin', 'room']);
    });

    it('runs onLeave / onDispose: room before plugins (default order)', async () => {
      const order: string[] = [];
      class P extends RoomPlugin {
        onLeave() { order.push('plugin-leave'); }
        onDispose() { order.push('plugin-dispose'); }
      }
      class R extends Room {
        plugins = definePlugins({ p: new P() });
        onLeave() { order.push('room-leave'); }
        onDispose() { order.push('room-dispose'); }
      }
      const room = new R();
      runInit(room);
      await (room as any).onLeave({} as any);
      await (room as any).onDispose();
      assert.deepEqual(order, ['room-leave', 'plugin-leave', 'room-dispose', 'plugin-dispose']);
    });

    it('respects per-plugin order override', async () => {
      const order: string[] = [];
      class P extends RoomPlugin {
        order = { onLeave: 'before' as const };
        onLeave() { order.push('plugin'); }
      }
      class R extends Room {
        plugins = definePlugins({ p: new P() });
        onLeave() { order.push('room'); }
      }
      const room = new R();
      runInit(room);
      await (room as any).onLeave({} as any);
      // Override flips the default: plugin runs before the room.
      assert.deepEqual(order, ['plugin', 'room']);
    });

    it('runs multiple plugins in declaration order', async () => {
      const order: string[] = [];
      class A extends RoomPlugin { onJoin() { order.push('a'); } }
      class B extends RoomPlugin { onJoin() { order.push('b'); } }
      class C extends RoomPlugin { onJoin() { order.push('c'); } }
      class R extends Room {
        plugins = definePlugins({ a: new A(), b: new B(), c: new C() });
      }
      const room = new R();
      runInit(room);
      await (room as any).onJoin({} as any);
      assert.deepEqual(order, ['a', 'b', 'c']);
    });

    it('plugin hook throw aborts subsequent plugins + the room hook', async () => {
      const order: string[] = [];
      class A extends RoomPlugin {
        async onJoin() { order.push('a'); throw new Error('boom'); }
      }
      class B extends RoomPlugin {
        async onJoin() { order.push('b'); }
      }
      class R extends Room {
        plugins = definePlugins({ a: new A(), b: new B() });
        onJoin() { order.push('room'); }
      }
      const room = new R();
      runInit(room);
      await assert.rejects(() => (room as any).onJoin({} as any), /boom/);
      assert.deepEqual(order, ['a'], 'subsequent plugins + room should not run');
    });

    it('wraps the original room hook even when no plugin declares it', async () => {
      const order: string[] = [];
      class P extends RoomPlugin { /* no lifecycle hooks at all */ }
      class R extends Room {
        plugins = definePlugins({ p: new P() });
        onJoin() { order.push('room'); }
      }
      const room = new R();
      runInit(room);
      await (room as any).onJoin({} as any);
      // Room's hook still runs; just no plugins to invoke.
      assert.deepEqual(order, ['room']);
    });
  });

  describe('public method binding', () => {
    it('preserves plugin-class `this` on public methods', () => {
      class Counter extends RoomPlugin {
        private n = 0;
        increment() { this.n++; }
        get value() { return this.n; }
      }
      const counter = new Counter();
      class R extends Room {
        plugins = definePlugins({ counter });
      }
      const room = new R();
      runInit(room);
      // The room can call the plugin's public method
      room.plugins!.counter.increment();
      room.plugins!.counter.increment();
      assert.equal(counter.value, 2);
    });
  });

  describe('frozen after init', () => {
    it('freezes the plugins record so accidental mutation throws in strict mode', () => {
      class P extends RoomPlugin { }
      class R extends Room {
        plugins = definePlugins({ p: new P() });
      }
      const room = new R();
      runInit(room);
      assert.ok(Object.isFrozen(room.plugins), 'plugins record should be frozen');
    });
  });

  describe('plugin instance isolation', () => {
    it('one plugin instance per room — separate state across rooms', () => {
      class Counter extends RoomPlugin {
        n = 0;
        bump() { this.n++; }
      }
      class R extends Room {
        // Each instance constructs a fresh Counter via the field initializer.
        plugins = definePlugins({ counter: new Counter() });
      }
      const room1 = new R();
      const room2 = new R();
      runInit(room1);
      runInit(room2);
      room1.plugins!.counter.bump();
      room1.plugins!.counter.bump();
      room2.plugins!.counter.bump();
      assert.equal(room1.plugins!.counter.n, 2);
      assert.equal(room2.plugins!.counter.n, 1, 'rooms should not share plugin state');
    });
  });

  describe('class-level layout caching', () => {
    it('computes layout once per class and reuses on subsequent constructs', () => {
      class P extends RoomPlugin {
        onJoin() { /* no-op — exists so layout has a hook to wire */ }
      }
      class R extends Room {
        plugins = definePlugins({ p: new P() });
      }
      const r1 = new R(); runInit(r1);
      // The class has its layout cached after the first construct.
      assert.ok(
        (R as any).__pluginLayout,
        'layout should be cached on the constructor after first construct',
      );
      // Layout reference is stable across subsequent constructs.
      const layoutAfterR1 = (R as any).__pluginLayout;
      const r2 = new R(); runInit(r2);
      assert.strictEqual((R as any).__pluginLayout, layoutAfterR1, 'cached layout is stable');
    });

    it('installs lifecycle wrappers on the class prototype (not per-instance)', () => {
      class P extends RoomPlugin { onJoin() {} }
      class R extends Room {
        plugins = definePlugins({ p: new P() });
      }
      const r1 = new R();
      runInit(r1);
      // After init, the wrapper sits on the prototype — not on the instance.
      assert.strictEqual(
        (r1 as any).onJoin,
        (R.prototype as any).onJoin,
        'onJoin wrapper should live on the prototype, not be a per-instance closure',
      );
      // A second room shares the exact same wrapper function reference.
      const r2 = new R();
      runInit(r2);
      assert.strictEqual(
        (r1 as any).onJoin,
        (r2 as any).onJoin,
        'two rooms of the same class share the same prototype-level wrapper',
      );
    });
  });

  describe('definePlugins array form', () => {
    it("derives the record key from each plugin's pluginName", () => {
      class Alpha extends RoomPlugin {
        readonly pluginName = 'alpha' as const;
        ping() { return 'A'; }
      }
      class Beta extends RoomPlugin {
        readonly pluginName = 'beta' as const;
        pong() { return 'B'; }
      }
      class R extends Room {
        plugins = definePlugins([new Alpha(), new Beta()]);
      }
      const room = new R();
      runInit(room);
      // Static-typed access — these calls also exercise the
      // mapped-type result at compile time.
      assert.equal(room.plugins.alpha.ping(), 'A');
      assert.equal(room.plugins.beta.pong(), 'B');
    });

    it('throws when a plugin in the array is missing pluginName', () => {
      class Nameless extends RoomPlugin {}
      assert.throws(
        () => definePlugins([new Nameless()]),
        /is missing a 'pluginName' field/,
      );
    });

    it('throws when two plugins resolve to the same pluginName', () => {
      class P extends RoomPlugin {
        readonly pluginName = 'dup' as const;
      }
      assert.throws(
        () => definePlugins([new P(), new P()]),
        /two plugins resolve to pluginName "dup"/,
      );
    });

    it('record form still works without pluginName (back-compat)', () => {
      class P extends RoomPlugin {}
      const plugins = definePlugins({ adminChat: new P(), playerChat: new P() });
      assert.ok(plugins.adminChat instanceof P);
      assert.ok(plugins.playerChat instanceof P);
    });

    it('multi-instance via constructor-supplied pluginName', () => {
      class ChannelPlugin<N extends string> extends RoomPlugin {
        readonly pluginName: N;
        constructor(name: N) {
          super();
          this.pluginName = name;
        }
      }
      class R extends Room {
        plugins = definePlugins([
          new ChannelPlugin('admins'),
          new ChannelPlugin('players'),
        ]);
      }
      const room = new R();
      runInit(room);
      assert.ok(room.plugins.admins instanceof ChannelPlugin);
      assert.ok(room.plugins.players instanceof ChannelPlugin);
    });
  });

  describe('static dependencies (auto-include)', () => {
    it('auto-instantiates a declared dependency when not present', async () => {
      const calls: string[] = [];
      class Dep extends RoomPlugin {
        onJoin() { calls.push('dep.onJoin'); }
      }
      class User extends RoomPlugin {
        static dependencies = [Dep];
        onJoin() { calls.push('user.onJoin'); }
      }
      class R extends Room {
        plugins = definePlugins({ user: new User() });
        onJoin() { calls.push('room.onJoin'); }
      }
      const room: any = new R();
      runInit(room);

      // The auto-dep instance lives under a sentinel key on the
      // dedicated `_autoPlugins` map — not in `room.plugins` so
      // the user's typed view stays exactly what they declared.
      assert.equal(Object.keys(room.plugins), 'user', 'plugins keeps only the user record');
      assert.ok(room._autoPlugins, '_autoPlugins is populated when deps exist');
      assert.ok(room._autoPlugins['__dep:Dep'] instanceof Dep, 'Dep was auto-instantiated');

      await (room as any).onJoin({});
      // user.onJoin runs before room.onJoin (default order).
      // Dep declares no order override, so it also runs in the
      // before group — confirming auto-deps participate in
      // hook composition.
      assert.deepEqual(calls, ['user.onJoin', 'dep.onJoin', 'room.onJoin']);
    });

    it('skips auto-instantiation when the dep is already present in user plugins', () => {
      class Dep extends RoomPlugin {}
      class User extends RoomPlugin {
        static dependencies = [Dep];
      }
      const explicitDep = new Dep();
      class R extends Room {
        plugins = definePlugins({ user: new User(), dep: explicitDep });
      }
      const room: any = new R();
      runInit(room);

      // The explicit instance keeps its user-chosen key; no auto map.
      assert.strictEqual(room.plugins.dep, explicitDep);
      assert.equal(room._autoPlugins, undefined, '_autoPlugins absent when nothing was auto-added');
    });

    it('recursively walks transitive dependencies', async () => {
      const calls: string[] = [];
      class Inner extends RoomPlugin {
        onCreate() { calls.push('inner'); }
      }
      class Middle extends RoomPlugin {
        static dependencies = [Inner];
        onCreate() { calls.push('middle'); }
      }
      class Outer extends RoomPlugin {
        static dependencies = [Middle];
        onCreate() { calls.push('outer'); }
      }
      class R extends Room {
        plugins = definePlugins({ outer: new Outer() });
      }
      const room: any = new R();
      runInit(room);

      assert.ok(room._autoPlugins['__dep:Middle'] instanceof Middle);
      assert.ok(room._autoPlugins['__dep:Inner'] instanceof Inner);

      await (room as any).onCreate({});
      // All three onCreate hooks ran. Order across the before group
      // is the order entries were added to the layout (user first,
      // then deeper deps walked depth-first).
      assert.deepEqual(calls.sort(), ['inner', 'middle', 'outer']);
    });

    it('throws on dependency cycles', () => {
      class A extends RoomPlugin {}
      class B extends RoomPlugin { static dependencies = [A]; }
      // Mutate A *after* B is declared so the cycle A↔B is real.
      // A and B must BOTH be auto-deps (not user-provided) so the
      // walk visits them — a user-provided plugin is already marked
      // "present" and never enters the visiting set.
      (A as any).dependencies = [B];
      class Root extends RoomPlugin { static dependencies = [A]; }
      class R extends Room {
        plugins = definePlugins({ root: new Root() });
      }
      assert.throws(() => runInit(new R()), /plugin dependency cycle/);
    });

    it('throws a readable error when an auto-dep needs constructor args', () => {
      class NeedsOpts extends RoomPlugin {
        constructor(opts: { x: number }) {
          super();
          if (!opts) { throw new Error('opts required'); }
        }
      }
      class User extends RoomPlugin {
        static dependencies = [NeedsOpts as any];
      }
      class R extends Room {
        plugins = definePlugins({ user: new User() });
      }
      assert.throws(
        () => runInit(new R()),
        /auto-included plugin "NeedsOpts" must be constructible with no arguments/,
      );
    });

    it('caches the resolved layout per-class (deps walked once at class init)', () => {
      let depInstances = 0;
      class Dep extends RoomPlugin {
        constructor() { super(); depInstances++; }
      }
      class User extends RoomPlugin {
        static dependencies = [Dep];
      }
      class R extends Room {
        plugins = definePlugins({ user: new User() });
      }
      runInit(new R());
      runInit(new R());
      runInit(new R());
      // N rooms ⇒ 1 (layout-discovery instantiation, fires on the
      // first class init to read `order` + hook methods) + N
      // (per-room instances carrying per-room state).
      // If the layout cache wasn't working, every room would do a
      // full re-walk and we'd see 2*N instead of N+1.
      assert.equal(depInstances, 4);
    });
  });

});
