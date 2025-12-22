import assert from "assert";
import { schema, type SchemaType } from "@colyseus/schema";
import {
  Room,
  matchMaker,
  LocalPresence,
  LocalDriver,
  isDevMode,
  Server,
  Deferred,
  CloseCode,
} from "@colyseus/core";
import {
  setDevMode,
  cacheRoomHistory,
  reloadFromCache,
  getRoomRestoreListKey,
  getProcessRestoreKey,
  getPreviousProcessId,
} from "@colyseus/core/utils/DevMode";
import { Client as SDKClient } from "@colyseus/sdk";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { timeout } from "./utils/index.ts";

const DevModeState = schema({
  message: { type: "string", default: "hello" },
  count: { type: "number", default: 0 },
});
type DevModeState = SchemaType<typeof DevModeState>;

// State with nested structures (similar to MyRoom's state)
const Player = schema({
  x: "number",
  y: "number",
});
type Player = SchemaType<typeof Player>;

const NestedState = schema({
  mapWidth: "number",
  mapHeight: "number",
  players: { map: Player },
});
type NestedState = SchemaType<typeof NestedState>;

class DevModeRoom extends Room {
  cachedData: any;
  state = new DevModeState();

  onCreate(options: any) {
    if (options.roomId) {
      this.roomId = options.roomId;
    }
  }

  onCacheRoom() {
    return { customData: "cached" };
  }

  onRestoreRoom(cachedData: any) {
    // Extract the original cache data (without _cachedState)
    const { _cachedState, ...originalCache } = cachedData || {};
    this.cachedData = originalCache;
  }

  onJoin() {}
  onLeave() {}
  onDispose() {}
}

// Room with nested state (similar to MyRoom)
class NestedStateRoom extends Room {
  cachedData: any;
  state = new NestedState();

  onCreate(options: any) {
    this.state.mapWidth = 800;
    this.state.mapHeight = 600;
    if (options.roomId) {
      this.roomId = options.roomId;
    }
  }

  onCacheRoom() {
    return { nested: true };
  }

  onRestoreRoom(cachedData: any) {
    // Extract the original cache data (without _cachedState)
    const { _cachedState, ...originalCache } = cachedData || {};
    this.cachedData = originalCache;
  }

  onJoin() {}
  onLeave() {}
  onDispose() {}
}

describe("DevMode", () => {
  let presence: LocalPresence;
  let driver: LocalDriver;

  beforeEach(async () => {
    presence = new LocalPresence();
    driver = new LocalDriver();
    await matchMaker.setup(presence, driver);
    matchMaker.defineRoomType("devmode_room", DevModeRoom);
    matchMaker.defineRoomType("nested_room", NestedStateRoom);
  });

  afterEach(async () => {
    setDevMode(false);
    try {
      await matchMaker.gracefullyShutdown();
    } catch (e) {
      // Ignore "already_shutting_down" error from integration tests
      // that manage their own server lifecycle
    }
  });

  describe("setDevMode / isDevMode", () => {
    it("should default to false", () => {
      setDevMode(false); // reset
      assert.strictEqual(isDevMode, false);
    });

    it("should set devMode to true", () => {
      setDevMode(true);
      assert.strictEqual(isDevMode, true);
    });

    it("should set devMode to false", () => {
      setDevMode(true);
      setDevMode(false);
      assert.strictEqual(isDevMode, false);
    });
  });

  describe("getRoomRestoreListKey / getProcessRestoreKey", () => {
    it("getRoomRestoreListKey should return 'roomhistory'", () => {
      assert.strictEqual(getRoomRestoreListKey(), "roomhistory");
    });

    it("getProcessRestoreKey should return 'processhistory'", () => {
      assert.strictEqual(getProcessRestoreKey(), "processhistory");
    });
  });

  describe("getPreviousProcessId", () => {
    it("should return null when no previous process exists", async () => {
      const processId = await getPreviousProcessId("hostname");
      assert.strictEqual(processId, null);
    });

    it("should return the previous process id", async () => {
      await presence.hset(getProcessRestoreKey(), "hostname", "process-123");
      const processId = await getPreviousProcessId("hostname");
      assert.strictEqual(processId, "process-123");
    });

    it("should use empty string as default hostname", async () => {
      await presence.hset(getProcessRestoreKey(), "", "process-456");
      const processId = await getPreviousProcessId();
      assert.strictEqual(processId, "process-456");
    });
  });

  describe("cacheRoomHistory", () => {
    it("should cache room state and clients", async () => {
      // Create a room
      const roomListing = await matchMaker.createRoom("devmode_room", {});
      const room = matchMaker.getLocalRoomById(roomListing.roomId);

      const state = room.state as DevModeState;

      // Modify state
      state.message = "modified";
      state.count = 42;

      // Store initial room history (simulating what happens on room creation with devMode)
      await presence.hset(getRoomRestoreListKey(), room.roomId, JSON.stringify({
        roomName: "devmode_room",
        clientOptions: {},
      }));

      // Cache the room
      await cacheRoomHistory({ [room.roomId]: room });

      // Verify the cached data
      const cached = JSON.parse((await presence.hget(getRoomRestoreListKey(), room.roomId))!);
      assert.strictEqual(cached.roomName, "devmode_room");
      assert.ok(cached.state);
      assert.deepStrictEqual(cached.cache, { customData: "cached" });

      // Verify state was serialized
      const cachedState = JSON.parse(cached.state);
      assert.strictEqual(cachedState.message, "modified");
      assert.strictEqual(cachedState.count, 42);
    });

    it("should cache client sessionIds and reconnectionTokens", async () => {
      // Create a room
      const roomListing = await matchMaker.createRoom("devmode_room", {});
      const room = matchMaker.getLocalRoomById(roomListing.roomId);

      // Store initial room history
      await presence.hset(getRoomRestoreListKey(), room.roomId, JSON.stringify({
        roomName: "devmode_room",
        clientOptions: {},
      }));

      // Simulate clients by pushing to the clients array
      // Use object with minimal required properties for caching and cleanup
      const mockClient1 = { sessionId: "session-1", reconnectionToken: "token-1", ref: { removeAllListeners: () => {} } } as any;
      const mockClient2 = { sessionId: "session-2", reconnectionToken: "token-2", ref: { removeAllListeners: () => {} } } as any;
      room.clients.push(mockClient1, mockClient2);

      // Cache the room
      await cacheRoomHistory({ [room.roomId]: room });

      // Verify clients were cached with sessionIds and reconnectionTokens
      const cached = JSON.parse((await presence.hget(getRoomRestoreListKey(), room.roomId))!);
      assert.deepStrictEqual(cached.clients, [
        { sessionId: "session-1", reconnectionToken: "token-1" },
        { sessionId: "session-2", reconnectionToken: "token-2" },
      ]);

      // Clean up mock clients before afterEach
      room.clients.length = 0;
    });

    it("should include reserved seats in cached clients", async () => {
      // Create a room
      const roomListing = await matchMaker.createRoom("devmode_room", {});
      const room = matchMaker.getLocalRoomById(roomListing.roomId);

      // Simulate reserved seats (using internal _reservedSeats property)
      room['_reserveSeat']("reserved-1", {});
      room['_reserveSeat']("reserved-2", {});

      // Store initial room history
      await presence.hset(getRoomRestoreListKey(), room.roomId, JSON.stringify({
        roomName: "devmode_room",
        clientOptions: {},
      }));

      // Cache the room
      await cacheRoomHistory({ [room.roomId]: room });

      // Verify reserved seats were cached (without reconnectionTokens since they're just reservations)
      const cached = JSON.parse((await presence.hget(getRoomRestoreListKey(), room.roomId))!);
      const sessionIds = cached.clients.map((c: any) => c.sessionId);
      assert.ok(sessionIds.includes("reserved-1"));
      assert.ok(sessionIds.includes("reserved-2"));
    });

    it("should skip rooms without existing history", async () => {
      // Create a room but don't add initial history
      const roomListing = await matchMaker.createRoom("devmode_room", {});
      const room = matchMaker.getLocalRoomById(roomListing.roomId);

      // Cache the room (should not throw)
      await cacheRoomHistory({ [room.roomId]: room });

      // Verify no data was cached (hget returns null for non-existent keys)
      const cached = await presence.hget(getRoomRestoreListKey(), room.roomId);
      assert.strictEqual(cached, null);
    });
  });

  describe("restoring room's state from cache", () => {
    it("should restore rooms from cache", async () => {
      // Enable devMode so rooms are restored with the same roomId
      setDevMode(true);

      const roomId = "restored-room-id";

      // Store room history in presence
      await presence.hset(getRoomRestoreListKey(), roomId, JSON.stringify({
        roomName: "devmode_room",
        clientOptions: { someOption: true },
        state: JSON.stringify({ message: "restored", count: 100 }),
        cache: { customData: "restored-cache" },
        clients: [],
      }));

      // Reload from cache
      await reloadFromCache();

      // Verify room was restored
      const restoredRoom = matchMaker.getLocalRoomById(roomId);
      const state = restoredRoom.state as DevModeState;
      assert.ok(restoredRoom, "Room should be restored");
      assert.strictEqual(state.message, "restored");
      assert.strictEqual(state.count, 100);
      assert.deepStrictEqual((restoredRoom as DevModeRoom).cachedData, { customData: "restored-cache" });
    });

    it("should reserve seats for previous clients", async () => {
      // Enable devMode so rooms are restored with the same roomId
      setDevMode(true);

      const roomId = "restored-room-with-clients";

      // Store room history with clients (format: array of objects with sessionId and reconnectionToken)
      await presence.hset(getRoomRestoreListKey(), roomId, JSON.stringify({
        roomName: "devmode_room",
        clientOptions: {},
        clients: [
          { sessionId: "client-session-1", reconnectionToken: "token-1" },
          { sessionId: "client-session-2", reconnectionToken: "token-2" },
        ],
      }));

      // Reload from cache
      await reloadFromCache();

      // Verify room was restored
      const restoredRoom = matchMaker.getLocalRoomById(roomId);
      assert.ok(restoredRoom, "Room should be restored");

      // Verify seats were reserved (using internal _reservedSeats property)
      assert.ok(restoredRoom['_reservedSeats']["client-session-1"], "Seat for client-session-1 should be reserved");
      assert.ok(restoredRoom['_reservedSeats']["client-session-2"], "Seat for client-session-2 should be reserved");
    });

    it("should handle empty room history list", async () => {
      // No rooms in history - should not throw
      await reloadFromCache();
      assert.ok(true, "Should complete without error");
    });

    it("should handle rooms without state", async () => {
      // Enable devMode so rooms are restored with the same roomId
      setDevMode(true);

      const roomId = "room-without-state";

      // Store room history without state
      await presence.hset(getRoomRestoreListKey(), roomId, JSON.stringify({
        roomName: "devmode_room",
        clientOptions: {},
        clients: [],
      }));

      // Reload from cache
      await reloadFromCache();

      // Verify room was restored with default state
      const restoredRoom = matchMaker.getLocalRoomById(roomId);
      const state = restoredRoom.state as DevModeState;
      assert.ok(restoredRoom, "Room should be restored");
      assert.strictEqual(state.message, "hello"); // default value
      assert.strictEqual(state.count, 0); // default value
    });

    it("should restore rooms with nested state structures (maps)", async () => {
      // Enable devMode so rooms are restored with the same roomId
      setDevMode(true);

      const roomId = "nested-state-room";

      // Store room history with nested state including a players map
      await presence.hset(getRoomRestoreListKey(), roomId, JSON.stringify({
        roomName: "nested_room",
        clientOptions: {},
        state: JSON.stringify({
          mapWidth: 1024,
          mapHeight: 768,
          players: {
            "player-1": { x: 100, y: 200 },
            "player-2": { x: 300, y: 400 },
          },
        }),
        cache: { nested: true },
        clients: [],
      }));

      // Reload from cache - this was failing before the fix with:
      // TypeError: Cannot read properties of undefined (reading 'root')
      await reloadFromCache();

      // Verify room was restored
      const restoredRoom = matchMaker.getLocalRoomById(roomId);
      const state = restoredRoom.state as NestedState;
      assert.ok(restoredRoom, "Room should be restored");
      assert.strictEqual(state.mapWidth, 1024);
      assert.strictEqual(state.mapHeight, 768);

      // Verify nested map was restored
      assert.strictEqual(state.players.size, 2);
      const player1 = state.players.get("player-1");
      const player2 = state.players.get("player-2");
      assert.ok(player1, "player-1 should exist");
      assert.ok(player2, "player-2 should exist");
      assert.strictEqual(player1.x, 100);
      assert.strictEqual(player1.y, 200);
      assert.strictEqual(player2.x, 300);
      assert.strictEqual(player2.y, 400);

      // Verify cached data was restored
      assert.deepStrictEqual((restoredRoom as NestedStateRoom).cachedData, { nested: true });
    });
  });

  describe("integration test", () => {
    const TEST_PORT = 8568;
    const TEST_ENDPOINT = `ws://localhost:${TEST_PORT}`;

    // Room class for integration test
    class IntegrationDevModeRoom extends Room {
      state = new DevModeState();

      onCreate(options: any) {
        if (options.roomId) {
          this.roomId = options.roomId;
        }
        // Register message handler to modify state
        this.onMessage("increment", () => {
          this.state.count++;
        });
      }

      onCacheRoom() {
        return { testCache: "integration" };
      }

      onRestoreRoom(cachedData: any) {
        // Restore is handled automatically for state
      }

      onJoin() {}
      onLeave() {}
      onDispose() {}
    }

    it("should restore room's state from cache and SDK client should reconnect", async () => {
      // Use shared presence and driver across server restarts
      const sharedPresence = new LocalPresence();
      const sharedDriver = new LocalDriver();

      // Create first server with devMode enabled
      const server1 = new Server({
        greet: false,
        gracefullyShutdown: false,
        devMode: true,
        presence: sharedPresence,
        driver: sharedDriver,
        transport: new WebSocketTransport({ pingInterval: 100, pingMaxRetries: 3 }),
      });

      server1.define("devmode_integration", IntegrationDevModeRoom);
      await server1.listen(TEST_PORT);

      // Create SDK client
      const sdkClient = new SDKClient(TEST_ENDPOINT);

      // Join room and get initial state
      const roomConnection = await sdkClient.joinOrCreate<DevModeState>("devmode_integration");

      // Configure reconnection for immediate retry (for testing)
      roomConnection.reconnection.minUptime = 0;
      roomConnection.reconnection.delay = 10; // Very short delay for test
      roomConnection.reconnection.minDelay = 10;

      // Wait for initial state sync
      await timeout(50);

      // Verify initial state
      assert.strictEqual(roomConnection.state.message, "hello");
      assert.strictEqual(roomConnection.state.count, 0);

      // Modify state via message
      roomConnection.send("increment");
      roomConnection.send("increment");
      roomConnection.send("increment");

      // Wait for state changes to be processed
      await timeout(100);

      // Verify state was modified
      assert.strictEqual(roomConnection.state.count, 3);

      // Track events using wrapper objects to allow reassignment
      const dropTracker = { deferred: new Deferred<number>() };
      const reconnectTracker = { deferred: new Deferred<void>() };

      roomConnection.onDrop((code) => {
        dropTracker.deferred.resolve(code);
      });

      roomConnection.onReconnect(() => {
        reconnectTracker.deferred.resolve();
      });

      // Store roomId for verification
      const originalRoomId = roomConnection.roomId;
      const originalSessionId = roomConnection.sessionId;

      // Gracefully shutdown first server (this triggers cacheRoomHistory in devMode)
      await server1.gracefullyShutdown(false);

      // Wait for client to receive onDrop
      let dropCode = await dropTracker.deferred;
      assert.strictEqual(dropCode, CloseCode.DEVMODE_RESTART, "Client should receive DEVMODE_RESTART close code");

      // Create second server with same presence/driver (to access cached data)
      // This must happen quickly before the SDK gives up on reconnection
      const server2 = new Server({
        greet: false,
        gracefullyShutdown: false,
        devMode: true,
        presence: sharedPresence,
        driver: sharedDriver,
        transport: new WebSocketTransport({ pingInterval: 100, pingMaxRetries: 3 }),
      });

      server2.define("devmode_integration", IntegrationDevModeRoom);
      await server2.listen(TEST_PORT);

      // Wait for client to auto-reconnect
      await reconnectTracker.deferred;

      // Wait for state sync after reconnection
      await timeout(100);

      // Verify room was restored with same roomId
      let restoredRoom = matchMaker.getLocalRoomById(originalRoomId);
      assert.ok(restoredRoom, "Room should be restored with same roomId");
      assert.strictEqual(roomConnection.roomId, originalRoomId, "Reconnected room should have same roomId");
      assert.strictEqual(roomConnection.sessionId, originalSessionId, "Session ID should be preserved");

      // Verify client state is preserved
      assert.strictEqual(roomConnection.state.count, 3, "State count should be preserved after reconnection");
      assert.strictEqual(roomConnection.state.message, "hello", "State message should be preserved");

      // Verify server-side state is also correct
      let serverState = restoredRoom.state as DevModeState;
      assert.strictEqual(serverState.count, 3, "Server-side state count should be 3");

      // ======================================================================
      // SECOND SERVER RESTART: Test that reconnectionToken is properly cached
      // ======================================================================

      // Modify state again before second restart
      roomConnection.send("increment");
      roomConnection.send("increment");
      await timeout(100);
      assert.strictEqual(roomConnection.state.count, 5, "State count should be 5 before second restart");

      // Reset deferreds for second reconnection
      dropTracker.deferred = new Deferred<number>();
      reconnectTracker.deferred = new Deferred<void>();

      // Gracefully shutdown second server
      await server2.gracefullyShutdown(false);

      // Wait for client to receive onDrop
      dropCode = await dropTracker.deferred;
      assert.strictEqual(dropCode, CloseCode.DEVMODE_RESTART, "Client should receive DEVMODE_RESTART close code on second restart");

      // Create third server with same presence/driver
      const server3 = new Server({
        greet: false,
        gracefullyShutdown: false,
        devMode: true,
        presence: sharedPresence,
        driver: sharedDriver,
        transport: new WebSocketTransport({ pingInterval: 100, pingMaxRetries: 3 }),
      });

      server3.define("devmode_integration", IntegrationDevModeRoom);
      await server3.listen(TEST_PORT);

      // Wait for client to auto-reconnect (second time)
      await reconnectTracker.deferred;

      // Wait for state sync after second reconnection
      await timeout(100);

      // Verify room was restored with same roomId after second restart
      restoredRoom = matchMaker.getLocalRoomById(originalRoomId);
      assert.ok(restoredRoom, "Room should be restored with same roomId after second restart");
      assert.strictEqual(roomConnection.roomId, originalRoomId, "Reconnected room should have same roomId after second restart");
      assert.strictEqual(roomConnection.sessionId, originalSessionId, "Session ID should be preserved after second restart");

      // Verify client state is preserved after second restart
      assert.strictEqual(roomConnection.state.count, 5, "State count should be preserved after second reconnection");
      assert.strictEqual(roomConnection.state.message, "hello", "State message should be preserved after second reconnection");

      // Verify server-side state is also correct
      serverState = restoredRoom.state as DevModeState;
      assert.strictEqual(serverState.count, 5, "Server-side state count should be 5 after second restart");

      // Cleanup
      await roomConnection.leave();
      await timeout(50);
      await server3.gracefullyShutdown(false);
    });
  });
});
