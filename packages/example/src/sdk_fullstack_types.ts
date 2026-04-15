import { ColyseusSDK, getStateCallbacks } from "@colyseus/sdk";
import type { server } from "./app.config.ts";

const sdk = new ColyseusSDK<typeof server>("ws://localhost:2567");

sdk.http.get("/things");

// @ts-expect-error - params is required for /things/:id
sdk.http.get("/things/:id");

// ✓ This works! params is provided
sdk.http.get("/things/:id", {
  params: { id: "123" }
});

// Test if calling post without arguments works (should fail if body has required fields)
// @ts-expect-error - Expected 2 arguments, but got 1
sdk.http.post("/users");

// @ts-expect-error - body is required for /users
sdk.http.post("/users", {})

// @ts-expect-error - body.name is required for /things
sdk.http.post("/things")
// @ts-expect-error - body is required for /things
sdk.http.post("/things", {})
// @ts-expect-error - body.name is required for /things
sdk.http.post("/things", { body: {} })

sdk.http.post("/things", {
  body: { name: "hello" },
  query: {}
})

// ✓ This works! Query is optional when all its fields are optional
sdk.http.post("/things", {
  body: { name: "hello" },
})

// This should work
sdk.http.post("/users", {
  body: {
    email: "test@example.com",
    username: "testuser",
    password: "password123"
  }
})

// @ts-expect-error - params is required for /things/:id (DELETE)
sdk.http.delete("/things/:id");

// ✓ This works! params is provided for DELETE
sdk.http.delete("/things/:id", {
  params: { id: "123" }
});

// @ts-expect-error - params is required for /things/:id (PATCH)
sdk.http.patch("/things/:id");

// ✓ This works! params is provided (body is optional for PATCH since all fields are optional)
sdk.http.patch("/things/:id", {
  params: { id: "123" }
});

// ✓ This works! params and body are provided for PATCH
sdk.http.patch("/things/:id", {
  params: { id: "123" },
  body: { name: "updated" }
});

// @ts-expect-error - params is required for /things/:id (PUT)
sdk.http.put("/things/:id");

// @ts-expect-error - params and body are required for /things/:id (PUT)
sdk.http.put("/things/:id", {
  params: { id: "123" }
});

// ✓ This works! params and body are provided for PUT
sdk.http.put("/things/:id", {
  params: { id: "123" },
  body: {
    name: "updated",
    description: "updated description",
    tags: ["tag1", "tag2"]
  }
});

// Issue #933 — PUT endpoint with only `body` declared (no query, no params).
// Per the issue, the type checker currently demands `query` and `params`
// even though the endpoint declared neither.

// @ts-expect-error - body is required for /api/v1/players/me
sdk.http.put("/api/v1/players/me");

// @ts-expect-error - body is required
sdk.http.put("/api/v1/players/me", {});

// This SHOULD typecheck (body-only, no query, no params).
// If issue #933 is reproduced, this line errors with:
//   "Type '{ body: ... }' is missing the following properties: query, params"
sdk.http.put("/api/v1/players/me", {
  body: { username: "Johnny", race: "DWARF" },
});

// --- Related coverage: make sure the fix didn't loosen surrounding cases ---

// PATCH body-only, body fields all optional → whole options arg should be optional
sdk.http.patch("/api/v1/players/me/profile");
sdk.http.patch("/api/v1/players/me/profile", { body: {} });
sdk.http.patch("/api/v1/players/me/profile", { body: { bio: "hi" } });

// DELETE body-only, body has a required field
// @ts-expect-error - body is required for /api/v1/things/bulk-delete
sdk.http.delete("/api/v1/things/bulk-delete");
// @ts-expect-error - body.ids is required
sdk.http.delete("/api/v1/things/bulk-delete", { body: {} });
sdk.http.delete("/api/v1/things/bulk-delete", { body: { ids: ["a", "b"] } });

// GET query-only, required query field
// @ts-expect-error - query is required for /api/v1/search
sdk.http.get("/api/v1/search");
// @ts-expect-error - query.q is required
sdk.http.get("/api/v1/search", { query: {} });
sdk.http.get("/api/v1/search", { query: { q: "hello" } });
sdk.http.get("/api/v1/search", { query: { q: "hello", limit: 10 } });

// GET query-only, all query fields optional → everything optional
sdk.http.get("/api/v1/articles");
sdk.http.get("/api/v1/articles", { query: {} });
sdk.http.get("/api/v1/articles", { query: { page: 2 } });

// Multi-param path: params required (body/query untouched)
// @ts-expect-error - params is required for nested path
sdk.http.get("/api/v1/posts/:postId/comments/:commentId");
// @ts-expect-error - commentId param missing
sdk.http.get("/api/v1/posts/:postId/comments/:commentId", {
  params: { postId: "1" },
});
sdk.http.get("/api/v1/posts/:postId/comments/:commentId", {
  params: { postId: "1", commentId: "42" },
});

// Multi-param path + required body
// @ts-expect-error - params and body both required
sdk.http.put("/api/v1/posts/:postId/comments/:commentId");
// @ts-expect-error - body is required even when params is provided
sdk.http.put("/api/v1/posts/:postId/comments/:commentId", {
  params: { postId: "1", commentId: "42" },
});
sdk.http.put("/api/v1/posts/:postId/comments/:commentId", {
  params: { postId: "1", commentId: "42" },
  body: { text: "updated" },
});

async function connect() {
  const room = await sdk.joinOrCreate("my_room");

  room.onMessage("hello", (payload) => {
    //
  });

  room.send("move", { x: 100, y: 200 });

  // @ts-expect-error - "movee" is not a valid message type
  room.send("movee", { x: 100, y: 200 });

  const $ = getStateCallbacks(room);
  $(room.state).players.onAdd((player, sessionId) => {
  });
}
