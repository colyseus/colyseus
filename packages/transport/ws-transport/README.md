# @colyseus/ws-transport

```typescript
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";

const gameServer = new Server({
  transport: new WebSocketTransport(),
  // ...
})
```

Re-using existing http server and/or Express:

```typescript
import http from "http";
import express from "express";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";

const app = express();
const server = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
  // ...
})
```
