import { createEndpoint, createRouter } from "@colyseus/core";
import config, { listen } from "@colyseus/tools";

// import { Client } from "@colyseus/sdk";

const listThings = createEndpoint("/things", { method: "GET" }, async (ctx) => {
  return { things: [1, 2, 3, 4, 5, 6] };
})

const server = config({
  routes: createRouter({ listThings }, {
    onError: (err) => {
      console.log(err);
    },
    onRequest: (req) => {
      console.log(req);
    },
    onResponse: (res) => {
      console.log(res);
    },
  }),
  initializeExpress: (app) => {
    app.get("/", (_, res) => res.json({ message: "Hello World" }));
    app.get("/express", (_, res) => res.json({ message: "Hello World" }));
  }
})

listen(server);

// const client = new Client<typeof server>("ws://localhost:2567");