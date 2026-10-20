import assert from "assert";

import { schema, StateView, type SchemaType } from "@colyseus/schema";
import { Client as SDKClient } from "@colyseus/sdk";
import { WebSocketTransport } from "@colyseus/ws-transport";
import {
  ClientState,
  LocalDriver,
  LocalPresence,
  matchMaker,
  Room,
  Server,
} from "@colyseus/core";
import { decodeFrames, fakeClient, serializerFor, waitUntil } from "./utils/index.ts";

//
// A transport may write what `client.raw()` was handed long after the call
// (permessage-deflate, a socket with backpressure). A frame queued that way
// must keep its bytes when the serializer encodes again.
//
// See: https://github.com/colyseus/colyseus/issues/982
//

const Item = schema({ v: "uint16", name: "string" });
const State = schema({ n: { type: "uint16", default: 0 }, items: { map: Item } });
type State = SchemaType<typeof State>;

/** Two patches: the second rewrites the first one's bytes in the shared buffer. */
function patchTwice(state: State, send: () => void) {
  state.items.set("one", new Item({ v: 1, name: "one" }));
  send();
  state.items.get("one")!.v = 2;
  state.items.set("two", new Item({ v: 1, name: "the second one, with a longer name" }));
  state.n = 7;
  send();
}

describe("State frames held by a stalled transport", () => {

  it("a queued patch keeps its bytes when the next patch is encoded", () => {
    const state = new State();
    const serializer = serializerFor(state);
    const client = fakeClient();

    serializer.applyPatches([client]);
    patchTwice(state, () => serializer.applyPatches([client]));

    assert.deepStrictEqual(decodeFrames(State, client.reliable), state.toJSON());
  });

  it("a queued patch keeps its bytes in a room with filters", () => {
    const FilteredState = schema({
      n: { type: "uint16", default: 0 },
      items: { map: Item },
      secret: { type: "string", view: true },
    });

    const state = new FilteredState();
    const serializer = serializerFor(state);

    // without a view: the shared patch. With one: a per-view encode in between.
    const blind = fakeClient();
    const seer = fakeClient(new StateView());
    const clients = [blind, seer];

    serializer.applyPatches(clients);
    patchTwice(state as any, () => serializer.applyPatches(clients));

    assert.deepStrictEqual(decodeFrames(FilteredState, blind.reliable), state.toJSON());
    assert.deepStrictEqual(decodeFrames(FilteredState, seer.reliable), state.toJSON());
  });

  it("a queued full state keeps its bytes when the next joiner re-encodes it", () => {
    const state = new State();
    state.items.set("a", new Item({ v: 1, name: "only the first joiner sees this" }));
    const serializer = serializerFor(state);

    const first = fakeClient();
    first.raw(serializer.getFullState(first));
    const firstExpected = state.toJSON();

    state.items.delete("a");
    state.items.set("b", new Item({ v: 2, name: "b" }));
    state.n = 9;

    const second = fakeClient();
    second.raw(serializer.getFullState(second));

    assert.deepStrictEqual(decodeFrames(State, first.reliable), firstExpected);
    assert.deepStrictEqual(decodeFrames(State, second.reliable), state.toJSON());
  });

  describe("ws-transport", () => {
    const TEST_PORT = 8581;

    class WireRoom extends Room {
      state = new State();
      onCreate() { this.patchRate = 0; }
    }

    let server: Server;
    let driver: LocalDriver;

    before(async () => {
      const presence = new LocalPresence();
      driver = new LocalDriver();
      server = new Server({ greet: false, gracefullyShutdown: false, presence, driver, transport: new WebSocketTransport() });
      await matchMaker.setup(presence, driver);
      server.define("wire", WireRoom);
      await server.listen(TEST_PORT);
    });

    after(async () => {
      await driver.clear();
      await server.gracefullyShutdown(false);
    });

    it("patches written while the socket is backed up arrive intact", async () => {
      const conn = await new SDKClient(`ws://localhost:${TEST_PORT}`).joinOrCreate<State>("wire");
      const room = matchMaker.getLocalRoomById(conn.roomId) as WireRoom;
      await waitUntil(() => room.clients[0]?.state === ClientState.JOINED);

      // a corked socket queues writes by reference, as one with backpressure does
      const socket = (room.clients[0] as any).ref._socket;
      socket.cork();
      patchTwice(room.state, () => room.broadcastPatch());
      socket.uncork();
      await waitUntil(() => conn.state.n === 7);

      assert.deepStrictEqual(conn.state.toJSON(), room.state.toJSON());
      await conn.leave();
    });
  });

});
