process.env.JWT_SECRET = "test";
process.env.SESSION_SECRET = "SESSION_SECRET";

import path from "node:path";
import fs from "node:fs";

import config, { listen } from "@colyseus/tools";
import { createEndpoint, createRouter, defineRoom, matchMaker } from "@colyseus/core";
import { playground } from "@colyseus/playground";
import { monitor } from "@colyseus/monitor";
import { auth } from "@colyseus/auth";
import { z } from "zod";
import { exposeServerToTraefik } from "@colyseus/traefik";

import { RedisPresence } from "@colyseus/redis-presence";
import { RedisDriver } from "@colyseus/redis-driver";
import { PostgresDriver } from "@colyseus/drizzle-driver";

// import { Client } from "@colyseus/sdk";
// const client = new Client<typeof server>("ws://localhost:2567");

import { MyRoom } from "./MyRoom.ts";

auth.oauth.addProvider("discord", {
  key: "799645393566695465",
  secret: "Kjv9bvAa9ZRBe8LBM5ZJ6bJsH0o44HdT",
  scope: ["identify", "email"]
})

// The endpoints below double as fixtures for the SDK client-side type tests
// in `sdk_fullstack_types.ts` — each one exercises a different combination of
// `body` / `query` / `params` (declared vs. undeclared, required vs. optional)
// so the inferred `client.http.*` signatures stay covered.

const index = createEndpoint("/", { method: "GET" }, async (ctx) => {
  return new Response(await fs.promises.readFile(path.join(import.meta.dirname, "index.html"), "utf8"), {
    headers: { "Content-Type": "text/html", },
  });
});

const listThings = createEndpoint("/things", {
  method: "GET",
  metadata: {
    openapi: {
      description: "List all things lorem ipsum dolor sit amet lorem ipsum dolor sit amet lorem ipsum dolor sit amet lorem ipsum dolor sit amet",
      summary: "List all things",
      tags: ["things"],
    }
  }
}, async (ctx) => {
  return { things: [1, 2, 3, 4, 5, 6] };
});

const getThing = createEndpoint("/things/:id", { method: "GET" }, async (ctx) => {
  const id = ctx.params.id;
  return { id, name: `Thing ${id}`, description: "A sample thing", createdAt: new Date().toISOString() };
});

const createThing = createEndpoint("/things", {
  method: "POST",
  body: z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  query: z.object({
    name: z.string().min(1, "Name is required").optional(),
  }),
  metadata: {
    openapi: {
      description: "Create a new thing",
    }
  }
}, async (ctx) => {
  const body = ctx.body;
  return {
    id: Math.floor(Math.random() * 1000),
    ...body,
    createdAt: new Date().toISOString()
  };
});

// Issue #933 reproduction: PUT with only `body` declared (no query, no params)
const setupMe = createEndpoint("/api/v1/players/me", {
  method: "PUT",
  body: z.object({
    username: z.string().min(3),
    race: z.enum(["HUMAN", "ELF", "DWARF"]),
  }),
}, async (ctx) => {
  return { ok: true, ...ctx.body };
});

// PATCH with only `body` declared (no query, no params)
const patchMe = createEndpoint("/api/v1/players/me/profile", {
  method: "PATCH",
  body: z.object({
    bio: z.string().optional(),
    avatar: z.string().url().optional(),
  }),
}, async (ctx) => ({ ok: true, ...ctx.body }));

// DELETE with only `body` declared (no query, no params)
const bulkDelete = createEndpoint("/api/v1/things/bulk-delete", {
  method: "DELETE",
  body: z.object({ ids: z.array(z.string()).min(1) }),
}, async (ctx) => ({ deleted: ctx.body.ids.length }));

// GET with only `query` declared (required)
const searchThings = createEndpoint("/api/v1/search", {
  method: "GET",
  query: z.object({
    q: z.string().min(1),
    limit: z.number().int().optional(),
  }),
}, async (ctx) => ({ q: ctx.query.q, results: [] }));

// GET with only `query` declared, all fields optional
const listArticles = createEndpoint("/api/v1/articles", {
  method: "GET",
  query: z.object({
    page: z.number().int().optional(),
    tag: z.string().optional(),
  }),
}, async (ctx) => ({ articles: [] }));

// Multi-param path: params required, no body, no query
const getPostComment = createEndpoint("/api/v1/posts/:postId/comments/:commentId", {
  method: "GET",
}, async (ctx) => ({ postId: ctx.params.postId, commentId: ctx.params.commentId }));

// Params + required body (common "update nested resource" shape)
const updatePostComment = createEndpoint("/api/v1/posts/:postId/comments/:commentId", {
  method: "PUT",
  body: z.object({ text: z.string().min(1) }),
}, async (ctx) => ({ ...ctx.params, text: ctx.body.text }));

const updateThing = createEndpoint("/things/:id", {
  method: "PUT",
  body: z.object({
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
    isActive: z.boolean().optional(),
  })
}, async (ctx) => {
  const id = ctx.params.id;
  const body = ctx.body;
  return {
    id,
    ...body,
    updatedAt: new Date().toISOString()
  };
});

const patchThing = createEndpoint("/things/:id", {
  method: "PATCH",
  body: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
  })
}, async (ctx) => {
  const id = ctx.params.id;
  const body = ctx.body;
  return {
    id,
    message: "Thing partially updated",
    updates: body,
    updatedAt: new Date().toISOString()
  };
});

const deleteThing = createEndpoint("/things/:id", { method: "DELETE" }, async (ctx) => {
  const id = ctx.params.id;
  return { success: true, id, message: `Thing ${id} deleted` };
});

const createUser = createEndpoint("/users", {
  method: "POST",
  body: z.object({
    email: z.email("Invalid email address"),
    username: z.string().min(3, "Username must be at least 3 characters"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    age: z.number().int().min(13, "Must be at least 13 years old").optional(),
    preferences: z.object({
      newsletter: z.boolean(),
      notifications: z.boolean(),
    }).optional(),
  })
}, async (ctx) => {
  const body = ctx.body;
  return {
    id: Math.floor(Math.random() * 10000),
    email: body.email,
    username: body.username,
    age: body.age,
    preferences: body.preferences || { newsletter: false, notifications: true },
    createdAt: new Date().toISOString(),
  };
});

const bulkCreateThings = createEndpoint("/things/bulk", {
  method: "POST",
  body: z.object({
    things: z.array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
      })
    ).min(1, "At least one thing is required"),
  })
}, async (ctx) => {
  const body = ctx.body;
  return {
    created: body.things.map((thing, index) => ({
      id: index + 1,
      ...thing,
      createdAt: new Date().toISOString(),
    })),
    count: body.things.length,
  };
})

const port = Number((process.env.PORT || 2567)) + Number(process.env.NODE_APP_INSTANCE || "0");

export const server = config({
  options: {
    devMode: true,
    // driver: new PostgresDriver(),

    // driver: new RedisDriver(),
    // presence: new RedisPresence(),

    // publicAddress: `localhost/${port}`,
  },

  rooms: {
    my_room: defineRoom(MyRoom).
      filterBy(["progress"]).
      sortBy({ clients: -1 }),
  },

  routes: createRouter({
    // index,
    listThings,
    getThing,
    createThing,
    setupMe,
    patchMe,
    bulkDelete,
    searchThings,
    listArticles,
    getPostComment,
    updatePostComment,
    updateThing,
    patchThing,
    deleteThing,
    createUser,
    bulkCreateThings,

    /**
     * create multiple dummy rooms
     */
    createDummyRooms: createEndpoint("/create-dummy-rooms", { method: "POST" }, async (ctx) => {
      const count = 300;
      for (let i = 0; i < count; i++) {
        await matchMaker.createRoom("my_room", {});
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // @ts-ignore
      matchMaker.driver.rooms[20].clients = 9;
      // @ts-ignore
      matchMaker.driver.rooms[21].clients = 99;
      // @ts-ignore
      matchMaker.driver.rooms[22].clients = 8;
      // @ts-ignore
      matchMaker.driver.rooms[23].clients = 800;
      // @ts-ignore
      matchMaker.driver.rooms[24].clients = 100;
      // @ts-ignore
      matchMaker.driver.rooms[25].clients = 10;
      // @ts-ignore
      matchMaker.driver.rooms[26].clients = 1;

      return { message: `${count} dummy rooms created` };
    })
  }, {
    onError: (err) => {
      // console.log(err);
    },
    onRequest: (req) => {
      // console.log(req);
    },
    onResponse: (res) => {
      // console.log(res);
    },
  }),

  initializeExpress: (app) => {
    // app.use("/playground", playground());
    app.use("/", playground());
    app.use("/monitor", monitor());
    app.get("/express", (_, res) => res.json({ message: "Hello World" }));
    app.use(auth.prefix, auth.routes({}));
  },

  beforeListen: async () => {
    // await matchMaker.createRoom("my_room", {});
  }
});

async function main () {
  const gameServer = await listen(server, port);

  // exposeServerToTraefik({
  //   server: gameServer,
  //   mainAddress: "localhost",
  //   provider: "redis"
  // });
}

main();
