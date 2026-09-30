/**
 * Two-process reproduction of https://github.com/colyseus/colyseus/issues/968
 *
 * A child process owns 3 rooms and becomes unreachable for 8 seconds. Meanwhile
 * this process tries to join one of its rooms: the join times out, and the
 * child's room listings are removed. The child is not dead, so it must
 * re-publish them once it is back.
 *
 * Needs a local Redis. From bundles/colyseus:
 *
 *   npx tsx test/manual/stalled-process.ts              # child blocks its event loop
 *   npx tsx test/manual/stalled-process.ts slow-redis   # child's Redis traffic is delayed by 3s each way
 *
 * Exits with 0 when all listings are back, 1 otherwise.
 */
import net from "net";
import { fork } from "child_process";
import { Server, Room, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RedisPresence } from "@colyseus/redis-presence";
import { RedisDriver } from "@colyseus/redis-driver";

const STALL_MS = 8000;
const SLOW_REDIS = process.argv.includes("slow-redis");
const REDIS_DELAY_MS = 3000;
const PROXY_PORT = 6390;

// the child reaches Redis through a proxy in the parent, which can delay its traffic
const redisOptions = (process.send && SLOW_REDIS) ? { port: PROXY_PORT } : {};

class MyRoom extends Room {
  autoDispose = false;
  onCreate() {}
}

const server = new Server({
  presence: new RedisPresence(redisOptions),
  driver: new RedisDriver(redisOptions),
  transport: new WebSocketTransport(),
});
server.define("my_room", MyRoom);

if (process.send) {
  await runChild();
} else {
  await runParent();
}

async function runChild() {
  await server.listen(3101);

  // handleCreateRoom() creates the room on THIS process.
  // (createRoom() could pick the parent, which has fewer rooms)
  const roomIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    roomIds.push((await matchMaker.handleCreateRoom("my_room", {})).roomId);
  }
  process.send!({ roomIds });

  process.on("message", () => {
    if (SLOW_REDIS) { return; } // the parent slows down the proxy instead
    const until = Date.now() + STALL_MS;
    while (Date.now() < until) { /* block the event loop */ }
    process.send!({ recovered: true });
  });
}

async function runParent() {
  await server.listen(3100);
  await matchMaker.driver.clear();

  let delay = 0;
  if (SLOW_REDIS) {
    const forward = (from: net.Socket, to: net.Socket) => from.on("data", (chunk) => {
      const send = () => { if (!to.destroyed) { to.write(chunk); } };
      (delay > 0) ? setTimeout(send, delay) : send();
    });
    net.createServer((client) => {
      const redis = net.connect(6379);
      forward(client, redis);
      forward(redis, client);
      client.on("close", () => redis.destroy());
      client.on("error", () => {});
      redis.on("error", () => {});
    }).listen(PROXY_PORT);
  }

  const child = fork(import.meta.filename, process.argv.slice(2), { execArgv: ["--import", "tsx"] });
  // tsx sends its own messages over this channel: wait for one that has `key`
  const nextMessage = (key: string) => new Promise<any>((resolve) => {
    child.on("message", function onMessage(message: any) {
      if (message?.[key] === undefined) { return; }
      child.off("message", onMessage);
      resolve(message);
    });
  });
  const listedRoomIds = async () => (await matchMaker.query({})).map((room) => room.roomId).sort();

  const { roomIds } = await nextMessage("roomIds");
  console.log("child created rooms:", roomIds);

  child.send("stall");
  delay = REDIS_DELAY_MS;
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    await matchMaker.joinById(roomIds[0], {});
  } catch (e: any) {
    console.log("join failed while the child was unreachable:", e.message);
  }
  console.log("listed while unreachable:", (await listedRoomIds()).length);

  if (SLOW_REDIS) {
    await new Promise((resolve) => setTimeout(resolve, STALL_MS));
    delay = 0;
  } else {
    await nextMessage("recovered");
  }

  // one check interval (5s), plus what is still in flight through the proxy
  await new Promise((resolve) => setTimeout(resolve, 5000 + REDIS_DELAY_MS * 2 + 1000));

  const listed = await listedRoomIds();
  const missing = roomIds.filter((roomId: string) => !listed.includes(roomId));

  console.log(missing.length === 0
    ? "OK: all room listings are back"
    : `FAIL: rooms still running but no longer listed: ${missing.join(", ")}`);

  child.kill();
  process.exit(missing.length === 0 ? 0 : 1);
}
