import assert from 'assert';
import { Room, RoomPlugin, definePlugins, attachToTestRoom } from '@colyseus/core';

/**
 * Phase 1 unit tests for the RoomPlugin wiring inside Room.
 *
 * We exercise the wiring directly instead of spinning up a server:
 *   - instantiate a Room subclass
 *   - set `messages` and `plugins`
 *   - call the private `__init()` to trigger the wiring
 *   - assert side effects (lifecycle composition, message merge, frozen, etc.)
 *
 * The plugin classes here are tiny stand-ins — not meant for production
 * use; they're shaped to verify framework behavior.
 */

// Test seam: __init is private; expose it via cast.
const runInit = (room: any) => room.__init();

describe('RoomPlugin core plumbing', () => {

  describe('room reference injection', () => {
    it('sets `room` on each plugin during __init', () => {
      class P extends RoomPlugin { }
      const p = new P();
      class R extends Room {
        plugins = definePlugins<this>({ p });
      }
      const room = new R();
      assert.equal(p.room, undefined, 'room should not be set before __init');
      runInit(room);
      assert.strictEqual(p.room, room, 'room should point at the host after __init');
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
        plugins = definePlugins<this>({ p: new P() });
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
        plugins = definePlugins<this>({ p: new P() });
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
        plugins = definePlugins<this>({ a: new A(), b: new B() });
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
        plugins = definePlugins<this>({ p: new P() });
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
        plugins = definePlugins<this>({ p: new P() });
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
        plugins = definePlugins<this>({ p: new P() });
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
        plugins = definePlugins<this>({ a: new A(), b: new B(), c: new C() });
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
        plugins = definePlugins<this>({ a: new A(), b: new B() });
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
        plugins = definePlugins<this>({ p: new P() });
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
        plugins = definePlugins<this>({ counter });
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
        plugins = definePlugins<this>({ p: new P() });
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
        plugins = definePlugins<this>({ counter: new Counter() });
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

});
