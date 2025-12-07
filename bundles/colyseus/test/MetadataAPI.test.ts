import assert from "assert";
import { matchMaker, Room, LocalPresence, type MatchMakerDriver } from "@colyseus/core";
import { DRIVERS } from "./utils/index.ts";

describe("Metadata API", () => {
  DRIVERS.forEach((DriverKlass) => {
    describe(`Metadata API using driver: '${DriverKlass.name}'`, () => {
      let driver: MatchMakerDriver;

      before(async () => {
        driver = new DriverKlass();

        // boot the driver if implemented
        if (driver.boot) { await driver.boot(); }

        await matchMaker.setup(new LocalPresence(), driver, "localhost");
      });

      beforeEach(async () => {
        await driver.clear();
        await matchMaker.setup(new LocalPresence(), driver, "localhost");
      });

      afterEach(async () => {
        await matchMaker.gracefullyShutdown();
      });

      after(async () => {
        await driver.clear();
        await driver.shutdown();
      });

      describe("Direct metadata assignment", () => {
        interface GameMetadata {
          difficulty: "easy" | "medium" | "hard";
          rating: number;
          region: string;
        }

        class GameRoom extends Room<{ metadata: GameMetadata }> {
          onCreate(options: any) {
            this.metadata = {
              difficulty: options.difficulty || "medium",
              rating: options.rating || 1000,
              region: options.region || "us-east"
            };
          }
        }

        it("should set metadata using direct assignment", async () => {
          matchMaker.defineRoomType("game_room", GameRoom);

          const seat = await matchMaker.create("game_room", {
            difficulty: "hard",
            rating: 1500,
            region: "eu-west"
          });

          const rooms = await matchMaker.query({ roomId: seat.room.roomId });
          assert.strictEqual(rooms.length, 1);
          assert.strictEqual(rooms[0].metadata.difficulty, "hard");
          assert.strictEqual(rooms[0].metadata.rating, 1500);
          assert.strictEqual(rooms[0].metadata.region, "eu-west");
        });

        it("should update metadata dynamically", async () => {
          class DynamicRoom extends Room<{ metadata: { status: string; round: number } }> {
            onCreate() {
              this.metadata = { status: "waiting", round: 1 };
            }

            async updateStatus(status: string) {
              await this.setMatchmaking({
                metadata: { ...this.metadata, status }
              });
            }
          }

          matchMaker.defineRoomType("dynamic_room", DynamicRoom);
          const seat = await matchMaker.create("dynamic_room");

          // Check initial metadata
          let rooms = await matchMaker.query({ roomId: seat.room.roomId });
          assert.strictEqual(rooms[0].metadata.status, "waiting");
          assert.strictEqual(rooms[0].metadata.round, 1);

          // Update metadata
          const room = matchMaker.getLocalRoomById(seat.room.roomId) as DynamicRoom;
          await room.updateStatus("in_progress");

          // Verify update
          rooms = await matchMaker.query({ roomId: seat.room.roomId });
          assert.strictEqual(rooms[0].metadata.status, "in_progress");
        });
      });

      describe("filterBy() with metadata fields", () => {
        interface LobbyMetadata {
          gameMode: "solo" | "duo" | "squad";
          difficulty: "easy" | "medium" | "hard";
          region: string;
        }

        class LobbyRoom extends Room<{ metadata: LobbyMetadata }> {
          onCreate(options: any) {
            this.metadata = {
              gameMode: options.gameMode,
              difficulty: options.difficulty,
              region: options.region
            };
          }
        }

        beforeEach(() => {
          matchMaker.defineRoomType("lobby", LobbyRoom)
            .filterBy(["gameMode", "difficulty", "region"]);
        });

        it("should create a room with metadata", async () => {
          await matchMaker.create("lobby", {
            gameMode: "solo",
            difficulty: "easy",
            region: "us-east",
            dummy: "dummy"
          });

          const rooms = await matchMaker.query({ name: "lobby" });
          assert.strictEqual(rooms.length, 1);
          assert.strictEqual(rooms[0].metadata.gameMode, "solo");
          assert.strictEqual(rooms[0].metadata.difficulty, "easy");
          assert.strictEqual(rooms[0].metadata.region, "us-east");
          assert.strictEqual(rooms[0].metadata.dummy, undefined);
        });

        it("should filter by single metadata field", async () => {
          // Create rooms with different game modes
          const seat1 = await matchMaker.joinOrCreate("lobby", {
            gameMode: "solo",
            difficulty: "easy",
            region: "us-east"
          });

          const seat2 = await matchMaker.joinOrCreate("lobby", {
            gameMode: "duo",
            difficulty: "easy",
            region: "us-east"
          });

          // Should create different rooms due to gameMode difference
          assert.notStrictEqual(seat1.room.roomId, seat2.room.roomId);

          // Joining with same gameMode should join existing room
          const seat3 = await matchMaker.joinOrCreate("lobby", {
            gameMode: "solo",
            difficulty: "easy",
            region: "us-east"
          });

          assert.strictEqual(seat1.room.roomId, seat3.room.roomId);
        });

        it("should filter by multiple metadata fields", async () => {
          const seat1 = await matchMaker.joinOrCreate("lobby", {
            gameMode: "squad",
            difficulty: "hard",
            region: "eu-west"
          });

          // Different difficulty - should create new room
          const seat2 = await matchMaker.joinOrCreate("lobby", {
            gameMode: "squad",
            difficulty: "easy",
            region: "eu-west"
          });

          assert.notStrictEqual(seat1.room.roomId, seat2.room.roomId);

          // Same all metadata fields - should join existing room
          const seat3 = await matchMaker.joinOrCreate("lobby", {
            gameMode: "squad",
            difficulty: "hard",
            region: "eu-west"
          });

          assert.strictEqual(seat1.room.roomId, seat3.room.roomId);
        });

        it("should filter by region metadata", async () => {
          const usEastSeat = await matchMaker.joinOrCreate("lobby", {
            gameMode: "duo",
            difficulty: "medium",
            region: "us-east"
          });

          const euWestSeat = await matchMaker.joinOrCreate("lobby", {
            gameMode: "duo",
            difficulty: "medium",
            region: "eu-west"
          });

          // Different regions should create different rooms
          assert.notStrictEqual(usEastSeat.room.roomId, euWestSeat.room.roomId);

          // Same region should join existing room
          const usEastSeat2 = await matchMaker.joinOrCreate("lobby", {
            gameMode: "duo",
            difficulty: "medium",
            region: "us-east"
          });

          assert.strictEqual(usEastSeat.room.roomId, usEastSeat2.room.roomId);
        });
      });

      describe("sortBy() with metadata fields", () => {
        interface RankedMetadata {
          skillRating: number;
          region: string;
        }

        class RankedRoom extends Room<{ metadata: RankedMetadata }> {
          onCreate(options: any) {
            this.maxClients = 4; // Increase to 4 for testing
            this.metadata = {
              skillRating: options.skillRating,
              region: options.region
            };
          }
        }

        beforeEach(() => {
          matchMaker.defineRoomType("ranked", RankedRoom)
            .filterBy(["region"])
            .sortBy({ skillRating: 1 }); // Ascending - match similar skill levels
        });

        it("should sort by metadata field in ascending order", async () => {
          // Create rooms with different skill ratings
          await matchMaker.create("ranked", { skillRating: 1000, region: "us" });
          await matchMaker.create("ranked", { skillRating: 1500, region: "us" });
          await matchMaker.create("ranked", { skillRating: 800, region: "us" });

          // Query rooms and verify they're sorted by skillRating (ascending)
          const rooms = await matchMaker.query({ name: "ranked" }, { skillRating: "asc" });
          assert.strictEqual(rooms.length, 3);
          assert.strictEqual(rooms[0].metadata.skillRating, 800);
          assert.strictEqual(rooms[1].metadata.skillRating, 1000);
          assert.strictEqual(rooms[2].metadata.skillRating, 1500);

          // Players should join rooms in skill rating order (ascending)
          const seat1 = await matchMaker.join("ranked", { region: "us" });
          assert.strictEqual(seat1.room.metadata.skillRating, 800);

          const seat2 = await matchMaker.join("ranked", { region: "us" });
          assert.strictEqual(seat2.room.metadata.skillRating, 800); // Same room as seat1
          assert.strictEqual(seat1.room.roomId, seat2.room.roomId); // Verify same room

          const seat3 = await matchMaker.join("ranked", { region: "us" });
          assert.strictEqual(seat3.room.metadata.skillRating, 800); // Still same room
          assert.strictEqual(seat1.room.roomId, seat3.room.roomId); // Verify same room

          // Now the 800 room is full (has 4 clients: 1 from create + 3 from join)
          // Next join should go to the 1000 room
          const seat4 = await matchMaker.join("ranked", { region: "us" });
          assert.strictEqual(seat4.room.metadata.skillRating, 1000); // Next room (first is full)
        });

        it("should sort by metadata field in descending order", async () => {
          // Redefine with descending sort
          matchMaker.removeRoomType("ranked");
          matchMaker.defineRoomType("ranked_desc", RankedRoom)
            .filterBy(['region'])
            .sortBy({ skillRating: -1 }); // Descending

          // Create rooms with different skill ratings
          await matchMaker.create("ranked_desc", { skillRating: 1000, region: "eu" });
          await matchMaker.create("ranked_desc", { skillRating: 1500, region: "eu" });
          await matchMaker.create("ranked_desc", { skillRating: 800, region: "eu" });

          // Query rooms and verify they're sorted by skillRating (descending)
          const rooms = await matchMaker.query({ name: "ranked_desc" }, { skillRating: -1 });
          assert.strictEqual(rooms.length, 3);
          assert.strictEqual(rooms[0].metadata.skillRating, 1500);
          assert.strictEqual(rooms[1].metadata.skillRating, 1000);
          assert.strictEqual(rooms[2].metadata.skillRating, 800);

          // Players should join highest rated room first
          const seat1 = await matchMaker.join("ranked_desc", { region: "eu" });
          assert.strictEqual(seat1.room.metadata.skillRating, 1500);

          const seat2 = await matchMaker.join("ranked_desc", { region: "eu" });
          assert.strictEqual(seat2.room.metadata.skillRating, 1500); // Same room

          const seat3 = await matchMaker.join("ranked_desc", { region: "eu" });
          assert.strictEqual(seat3.room.metadata.skillRating, 1500); // Still same room
          assert.strictEqual(seat1.room.roomId, seat3.room.roomId);

          // Now the 1500 room is full, next join should go to the 1000 room
          const seat4 = await matchMaker.join("ranked_desc", { region: "eu" });
          assert.strictEqual(seat4.room.metadata.skillRating, 1000); // Next room
        });
      });

      describe("Mixed filtering (metadata + regular fields)", () => {
        interface CustomMetadata {
          mapName: string;
          difficulty: string;
        }

        class CustomRoom extends Room<{ metadata: CustomMetadata }> {
          onCreate(options: any) {
            this.maxClients = options.maxClients || 4;
            this.metadata = {
              mapName: options.mapName,
              difficulty: options.difficulty
            };
          }
        }

        beforeEach(() => {
          matchMaker.defineRoomType("custom", CustomRoom)
            .filterBy(["maxClients", "mapName", "difficulty"]);
        });

        it("should filter by both regular and metadata fields", async () => {
          const seat1 = await matchMaker.joinOrCreate("custom", {
            maxClients: 4,
            mapName: "Forest",
            difficulty: "hard"
          });

          // Different maxClients - should create new room
          const seat2 = await matchMaker.joinOrCreate("custom", {
            maxClients: 8,
            mapName: "Forest",
            difficulty: "hard"
          });

          assert.notStrictEqual(seat1.room.roomId, seat2.room.roomId);

          // Different metadata - should create new room
          const seat3 = await matchMaker.joinOrCreate("custom", {
            maxClients: 4,
            mapName: "Desert",
            difficulty: "hard"
          });

          assert.notStrictEqual(seat1.room.roomId, seat3.room.roomId);

          // Same all fields - should join existing room
          const seat4 = await matchMaker.joinOrCreate("custom", {
            maxClients: 4,
            mapName: "Forest",
            difficulty: "hard"
          });

          assert.strictEqual(seat1.room.roomId, seat4.room.roomId);
        });
      });

      describe("Complex sorting scenarios", () => {
        interface ComplexMetadata {
          rating: number;
          priority: number;
        }

        class ComplexRoom extends Room<{ metadata: ComplexMetadata }> {
          onCreate(options: any) {
            this.maxClients = 3;
            this.metadata = {
              rating: options.rating,
              priority: options.priority
            };
          }
        }

        it("should support multiple sort criteria", async () => {
          matchMaker.defineRoomType("complex", ComplexRoom)
            .sortBy({
              priority: -1, // Higher priority first
              rating: 1,    // Then by rating ascending
              clients: -1              // Then by most clients
            });

          // Create rooms with various metadata
          await matchMaker.create("complex", { priority: 1, rating: 1000 });
          await matchMaker.create("complex", { priority: 2, rating: 1500 });
          await matchMaker.create("complex", { priority: 2, rating: 1000 });

          // First join should go to highest priority room
          const seat1 = await matchMaker.join("complex");
          assert.strictEqual(seat1.room.metadata.priority, 2);
        });
      });

      describe("Query with metadata", () => {
        interface QueryMetadata {
          status: string;
          level: number;
        }

        class QueryRoom extends Room<{ metadata: QueryMetadata }> {
          onCreate(options: any) {
            this.metadata = {
              status: options.status || "waiting",
              level: options.level || 1
            };
          }
        }

        beforeEach(async () => {
          matchMaker.defineRoomType("query_room", QueryRoom);

          // Create multiple rooms
          await matchMaker.create("query_room", { status: "waiting", level: 1 });
          await matchMaker.create("query_room", { status: "in_progress", level: 2 });
          await matchMaker.create("query_room", { status: "waiting", level: 3 });
        });

        it("should query rooms by metadata", async () => {
          // Query for rooms with specific metadata
          const waitingRooms = await matchMaker.query<QueryRoom>({
            name: "query_room",
            status: "waiting"
          });

          assert.strictEqual(waitingRooms.length, 2);
          waitingRooms.forEach(room => {
            assert.strictEqual(room.metadata!.status, "waiting");
          });
        });

        it("should query all rooms", async () => {
          const allRooms = await matchMaker.query({ name: "query_room" });
          assert.strictEqual(allRooms.length, 3);
        });
      });

      describe("Batched updates with setMatchmaking()", () => {
        it("should update multiple properties with a single persist call", async () => {
          interface BatchMetadata {
            status: string;
            round: number;
          }

          class BatchRoom extends Room<{ metadata: BatchMetadata }> {
            onCreate() {
              // Initial setup using direct assignment
              this.maxClients = 4;
              this.metadata = { status: "waiting", round: 0 };
            }

            async startGame() {
              // Update multiple properties at once
              await this.setMatchmaking({
                metadata: { status: "in_progress", round: 1 },
                private: true,
                locked: true
              });
            }
          }

          matchMaker.defineRoomType("batch_room", BatchRoom);
          const seat = await matchMaker.create("batch_room");
          const room = matchMaker.getLocalRoomById(seat.room.roomId) as BatchRoom;

          // Verify initial state
          let rooms = await matchMaker.query({ roomId: seat.room.roomId });
          assert.strictEqual(rooms[0].metadata.status, "waiting");
          assert.strictEqual(rooms[0].metadata.round, 0);
          assert.strictEqual(rooms[0].private, false);
          assert.strictEqual(rooms[0].locked, false);

          // Start game (batched update)
          await room.startGame();

          // Verify all properties updated
          rooms = await matchMaker.query({ roomId: seat.room.roomId });
          assert.strictEqual(rooms[0].metadata.status, "in_progress");
          assert.strictEqual(rooms[0].metadata.round, 1);
          assert.strictEqual(rooms[0].private, true);
          assert.strictEqual(rooms[0].locked, true);
        });
      });

      describe("Auto-population of metadata from filterBy", () => {
        interface AutoMetadata {
          gameType: string;
          map: string;
        }

        it("should automatically populate metadata from filterBy fields when not explicitly set", async () => {
          class AutoRoom extends Room<{ metadata: AutoMetadata }> {
            onCreate(options: any) {
              // Intentionally NOT setting this.metadata
              // to test if it gets auto-populated from filterBy fields
            }
          }

          matchMaker.defineRoomType("auto_room", AutoRoom)
            .filterBy(["gameType", "map"]);

          const seat = await matchMaker.joinOrCreate("auto_room", {
            gameType: "deathmatch",
            map: "dust2"
          });

          // Query the room to check if metadata was auto-populated
          const rooms = await matchMaker.query({ roomId: seat.room.roomId });
          assert.strictEqual(rooms.length, 1);

          // Verify metadata was automatically populated from filterBy fields
          assert.strictEqual(rooms[0].metadata.gameType, "deathmatch");
          assert.strictEqual(rooms[0].metadata.map, "dust2");

          // Verify filtering still works - should join the same room
          const seat2 = await matchMaker.joinOrCreate("auto_room", {
            gameType: "deathmatch",
            map: "dust2"
          });
          assert.strictEqual(seat.room.roomId, seat2.room.roomId);

          // Different metadata should create a new room
          const seat3 = await matchMaker.joinOrCreate("auto_room", {
            gameType: "capture_flag",
            map: "dust2"
          });
          assert.notStrictEqual(seat.room.roomId, seat3.room.roomId);

          // Verify the new room also has auto-populated metadata
          const rooms2 = await matchMaker.query({ roomId: seat3.room.roomId });
          assert.strictEqual(rooms2[0].metadata.gameType, "capture_flag");
          assert.strictEqual(rooms2[0].metadata.map, "dust2");
        });
      });

      describe("Backward compatibility", () => {
        it("should still support setMetadata() method", async () => {
          class LegacyRoom extends Room<{ metadata: { foo: string } }> {
            onCreate(options: any) {
              this.metadata = { foo: "bar" };
            }
          }

          matchMaker.defineRoomType("legacy", LegacyRoom);
          const seat = await matchMaker.create("legacy");

          const rooms = await matchMaker.query({ roomId: seat.room.roomId });
          assert.strictEqual(rooms[0].metadata.foo, "bar");
        });

        it("should support existing filterBy without metadata", async () => {
          class SimpleRoom extends Room {
            onCreate(options: any) {
              // Apply maxClients from options if provided
              if (options.maxClients) {
                this.maxClients = options.maxClients;
              }
            }
          }

          matchMaker.defineRoomType("simple", SimpleRoom)
            .filterBy(["maxClients"]);

          const seat1 = await matchMaker.joinOrCreate("simple", { maxClients: 4 });
          const seat2 = await matchMaker.joinOrCreate("simple", { maxClients: 4 });
          const seat3 = await matchMaker.joinOrCreate("simple", { maxClients: 8 });

          assert.strictEqual(seat1.room.roomId, seat2.room.roomId);
          assert.notStrictEqual(seat1.room.roomId, seat3.room.roomId);
        });

        it("should explicitly set metadata for a room", async () => {
          matchMaker.defineRoomType("dummy_with_metadata", class extends Room {
            onCreate(options: any) {
              this.setMetadata({ foo: "bar" });
            }
          }).filterBy(['maxClients']);

          const reservedSeat = await matchMaker.joinOrCreate("dummy_with_metadata");
          assert.strictEqual("bar", (await matchMaker.query({ roomId: reservedSeat.room.roomId }))[0].metadata.foo);
        });
      });

    });

  });
});
