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

async function connect() {
  const room = await sdk.joinOrCreate("my_room");

  room.send("move", { x: 100, y: 200 });
  // @ts-expect-error - "movee" is not a valid message type
  room.send("movee", { x: 100, y: 200 });

  const $ = getStateCallbacks(room);
  $(room.state).players.onAdd((player, sessionId) => {
  });
}
