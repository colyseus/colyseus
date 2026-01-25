import { describe, expectTypeOf, it } from "vitest";
import type { InferState, ExtractRoomMessages, ExtractRoomClientMessages } from "../src/index.js";
import type { Room as SDKRoom } from "@colyseus/sdk";

// Mock state types for testing (Schema types have ~refId as optional, like real Schema)
interface MyState {
    '~refId'?: number;  // Schema marker (optional like real Schema)
    count: number;
    players: string[];
}

interface OtherState {
    '~refId'?: number;  // Schema marker (optional like real Schema)
    name: string;
}

// Plain state without ~refId (not a Schema)
interface PlainState {
    count: number;
}

// Mock Schema base class (mirrors real Schema's ~refId declaration)
class MockSchema {
    '~refId'?: number;
}

// Mock Schema subclass for testing
class RealState extends MockSchema {
    count: number = 0;
}

// Mock room class with ~state phantom property (like real Room class)
class MockRoomWithState {
    '~state'!: MyState;
    state!: MyState;
}

// Mock room class with only state property (no ~state phantom)
class MockRoomWithOnlyState {
    state!: MyState;
}

// Mock room class that simulates extending Room without generics
// (has ~state as 'object' from default RoomOptions but concrete Schema state property)
class MockRoomWithGenericPhantom {
    '~state'!: object;  // Too generic, like Room<RoomOptions>
    state!: MyState;    // Concrete Schema state property (has ~refId)
}

// Mock room class with ~state as 'any' (another too-generic scenario)
class MockRoomWithAnyPhantom {
    '~state'!: any;     // Too generic
    state!: MyState;    // Concrete Schema state property (has ~refId)
}

// Mock room class with both state and ~state (~state is used for type extraction)
class MockRoomWithBothStateTypes {
    state!: OtherState;  // runtime state (Schema)
    '~state'!: MyState;  // phantom type marker
}

// Mock room class with messages
class MockRoomWithMessages {
    state!: MyState;
    messages!: {
        move: (client: any, message: { x: number; y: number }) => void;
        chat: (client: any, message: string) => void;
    };
}

// Mock room class with client messages
class MockRoomWithClientMessages {
    state!: MyState;
    '~client'!: {
        '~messages': {
            notify: string;
            update: { data: number };
        };
    };
}

describe("InferState", () => {
    it("should return explicit State type (S) when provided", () => {
        expectTypeOf<InferState<unknown, MyState>>().toEqualTypeOf<MyState>();
        expectTypeOf<InferState<MockRoomWithState, OtherState>>().toEqualTypeOf<OtherState>();
    });

    it("should extract ~state from constructor type (typeof Room)", () => {
        expectTypeOf<InferState<typeof MockRoomWithState, never>>().toEqualTypeOf<MyState>();
    });

    it("should extract ~state from instance type (Room)", () => {
        expectTypeOf<InferState<MockRoomWithState, never>>().toEqualTypeOf<MyState>();
    });

    it("should extract ~state over state property", () => {
        // ~state is MyState, state is OtherState - should use ~state
        expectTypeOf<InferState<typeof MockRoomWithBothStateTypes, never>>().toEqualTypeOf<MyState>();
        expectTypeOf<InferState<MockRoomWithBothStateTypes, never>>().toEqualTypeOf<MyState>();
    });

    it("should return T as-is when T is a Schema (has ~refId)", () => {
        // Schema types (with ~refId) are returned as-is
        expectTypeOf<InferState<MyState, never>>().toEqualTypeOf<MyState>();
        // Real Schema class should also work
        expectTypeOf<InferState<RealState, never>>().toEqualTypeOf<RealState>();
        expectTypeOf<InferState<typeof RealState, never>>().toEqualTypeOf<RealState>();
    });

    it("should return T as-is when no ~state or ~refId exists", () => {
        // Plain types without ~state or ~refId are returned as-is
        expectTypeOf<InferState<string, never>>().toEqualTypeOf<string>();
        expectTypeOf<InferState<number, never>>().toEqualTypeOf<number>();
        expectTypeOf<InferState<PlainState, never>>().toEqualTypeOf<PlainState>();
    });

    it("should return T as-is when state type has a 'state' property", () => {
        // This is the key test: a state type that happens to have a 'state' property
        // should NOT have that property extracted - it should return the whole type
        interface StateWithStateProperty {
            state: string;
            count: number;
            players: string[];
        }
        expectTypeOf<InferState<StateWithStateProperty, never>>().toEqualTypeOf<StateWithStateProperty>();
    });

    it("should return T as-is for class without ~state (only state property)", () => {
        // MockRoomWithOnlyState has state but no ~state, so T is returned as-is
        expectTypeOf<InferState<MockRoomWithOnlyState, never>>().toEqualTypeOf<MockRoomWithOnlyState>();
        expectTypeOf<InferState<typeof MockRoomWithOnlyState, never>>().toEqualTypeOf<typeof MockRoomWithOnlyState>();
    });

    it("should use state property when it has ~refId (Schema) even if ~state is generic", () => {
        // This simulates extending Room without generics:
        // class MyRoom extends Room { state = new MyState(); }
        // where ~state is 'object' but state is a Schema (has ~refId)
        expectTypeOf<InferState<MockRoomWithGenericPhantom, never>>().toEqualTypeOf<MyState>();
        expectTypeOf<InferState<typeof MockRoomWithGenericPhantom, never>>().toEqualTypeOf<MyState>();
    });

    it("should use state property when it has ~refId even if ~state is any", () => {
        // When state property is a Schema (has ~refId), use it regardless of ~state
        expectTypeOf<InferState<MockRoomWithAnyPhantom, never>>().toEqualTypeOf<MyState>();
        expectTypeOf<InferState<typeof MockRoomWithAnyPhantom, never>>().toEqualTypeOf<MyState>();
    });

    it("should work with real Schema class as state property", () => {
        // Simulates: class MyRoom extends Room { state = new RealState(); }
        class MockRoomWithRealSchema {
            '~state'!: object;  // Generic from Room<RoomOptions>
            state!: RealState;  // Concrete Schema class
        }
        expectTypeOf<InferState<MockRoomWithRealSchema, never>>().toEqualTypeOf<RealState>();
        expectTypeOf<InferState<typeof MockRoomWithRealSchema, never>>().toEqualTypeOf<RealState>();
    });
});

describe("ExtractRoomMessages", () => {
    it("should extract messages from constructor type", () => {
        type Messages = ExtractRoomMessages<typeof MockRoomWithMessages>;
        expectTypeOf<Messages>().toHaveProperty("move");
        expectTypeOf<Messages>().toHaveProperty("chat");
    });

    it("should extract messages from instance type", () => {
        type Messages = ExtractRoomMessages<MockRoomWithMessages>;
        expectTypeOf<Messages>().toHaveProperty("move");
        expectTypeOf<Messages>().toHaveProperty("chat");
    });

    it("should return empty object when no messages defined", () => {
        expectTypeOf<ExtractRoomMessages<MockRoomWithState>>().toEqualTypeOf<{}>();
    });

    it("SDKRoom<State> should be equivalent to SDKRoom<any, State>", () => {
        type RoomWithOneGeneric = SDKRoom<MyState>;
        type RoomWithTwoGenerics = SDKRoom<any, MyState>;
        expectTypeOf<RoomWithOneGeneric>().toEqualTypeOf<RoomWithTwoGenerics>();

        // Verify that .send() accepts string | number when Room type is any
        expectTypeOf<RoomWithOneGeneric["send"]>().toBeCallableWith("hello");
        expectTypeOf<RoomWithOneGeneric["send"]>().toBeCallableWith(123);
        expectTypeOf<RoomWithTwoGenerics["send"]>().toBeCallableWith("hello");
        expectTypeOf<RoomWithTwoGenerics["send"]>().toBeCallableWith(123);
    });
});

describe("ExtractRoomClientMessages", () => {
    it("should extract client messages from constructor type", () => {
        type Messages = ExtractRoomClientMessages<typeof MockRoomWithClientMessages>;
        expectTypeOf<Messages>().toHaveProperty("notify");
        expectTypeOf<Messages>().toHaveProperty("update");
    });

    it("should extract client messages from instance type", () => {
        type Messages = ExtractRoomClientMessages<MockRoomWithClientMessages>;
        expectTypeOf<Messages>().toHaveProperty("notify");
        expectTypeOf<Messages>().toHaveProperty("update");
    });

    it("should return empty object when no client messages defined", () => {
        expectTypeOf<ExtractRoomClientMessages<MockRoomWithState>>().toEqualTypeOf<{}>();
    });
});
