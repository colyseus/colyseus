import http from "http";
import Koa from "koa";

import { Server } from "../src";
import { DummyRoom } from "./DummyRoom";

const app = new Koa();
const port = Number(process.env.PORT || 2567);

app.use(ctx => {
  ctx.body = 'Hello Koa';
});

// Create Colyseus server
const server = http.createServer(app.callback());
const gameServer = new Server();

gameServer.attach({ server });

// Define DummyRoom as "chat"
gameServer.define("chat", DummyRoom)

gameServer.listen(port);

console.log(`Listening on ws://localhost:${ port }`)
