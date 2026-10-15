// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { schema, t, StateView, type SchemaType } from '@colyseus/schema';
import { SchemaSerializer } from '../src/serializer/SchemaSerializer.ts';
import { ClientState, type Client } from '../src/Transport.ts';

const TestState = schema({
  name: t.string(),
  value: t.number(),
});
type TestState = SchemaType<typeof TestState>;

const UnreliableState = schema({
  name: t.string(),
  pos: t.number().unreliable(),
});
type UnreliableState = SchemaType<typeof UnreliableState>;

const FilteredState = schema({
  tag: t.string(),
  secret: t.string().view(),
});
type FilteredState = SchemaType<typeof FilteredState>;

describe('SchemaSerializer buffer isolation', () => {
  it('does not mutate previously emitted patch frames on subsequent applyPatches', () => {
    const state = new TestState({ name: 'initial', value: 10 });

    const serializer = new SchemaSerializer<TestState>();
    serializer.reset(state);

    const receivedFrames: Uint8Array[] = [];
    const client: Client = {
      id: 'client1',
      sessionId: 's1',
      state: ClientState.JOINED,
      raw: (data: Uint8Array) => {
        // Simulates an async consumer or socket queue that retains data reference
        receivedFrames.push(data);
      },
    } as any;

    // Mutate state for tick 1
    state.name = 'tick-1-name';
    state.value = 42;
    serializer.applyPatches([client]);

    expect(receivedFrames.length).toBe(1);
    const frame1 = receivedFrames[0];
    const frame1Snapshot = Buffer.from(frame1);

    // Mutate state for tick 2 with completely different length/data
    state.name = 'tick-2-much-longer-overwriting-name';
    state.value = 9999;
    serializer.applyPatches([client]);

    expect(receivedFrames.length).toBe(2);

    // Verify that frame1 was not mutated in place by tick 2!
    expect(Buffer.compare(Buffer.from(frame1), frame1Snapshot)).toBe(0);
  });

  it('does not mutate previously returned getFullState buffer on subsequent full encodes', () => {
    const state = new TestState({ name: 'initial', value: 10 });

    const serializer = new SchemaSerializer<TestState>();
    serializer.reset(state);

    const fullState1 = serializer.getFullState();
    const fullState1Snapshot = Buffer.from(fullState1);

    // Mutate state and force re-encode of full state
    state.name = 'updated-longer-full-state-name';
    state.value = 8888;
    const client: Client = {
      id: 'c1',
      sessionId: 's1',
      state: ClientState.JOINED,
      raw: () => {},
    } as any;
    serializer.applyPatches([client]); // sets needFullEncode = true

    const fullState2 = serializer.getFullState();
    expect(fullState2.length).toBeGreaterThan(0);

    // Verify that fullState1 was not mutated in place
    expect(Buffer.compare(Buffer.from(fullState1), fullState1Snapshot)).toBe(0);
  });

  it('does not mutate previously emitted unreliable frames on subsequent applyUnreliablePatches', () => {
    const state = new UnreliableState({ name: 'initial', pos: 0 });

    const serializer = new SchemaSerializer<UnreliableState>();
    serializer.reset(state);

    const receivedFrames: Uint8Array[] = [];
    const client: Client = {
      id: 'client1',
      sessionId: 's1',
      state: ClientState.JOINED,
      raw: () => {},
      rawUnreliable: (data: Uint8Array) => {
        receivedFrames.push(data);
      },
    } as any;

    // Initial sync
    serializer.applyPatches([client]);

    // Tick 1 unreliable change
    state.pos = 100;
    serializer.applyUnreliablePatches([client]);

    expect(receivedFrames.length).toBe(1);
    const frame1 = receivedFrames[0];
    const frame1Snapshot = Buffer.from(frame1);

    // Tick 2 unreliable change
    state.pos = 999999;
    serializer.applyUnreliablePatches([client]);

    expect(receivedFrames.length).toBe(2);
    expect(Buffer.compare(Buffer.from(frame1), frame1Snapshot)).toBe(0);
  });

  it('does not mutate filtered view frames on subsequent applyPatches', () => {
    const state = new FilteredState({ tag: 'init', secret: 'hush' });

    const serializer = new SchemaSerializer<FilteredState>();
    serializer.reset(state);

    const receivedFrames: Uint8Array[] = [];
    const view = new StateView();
    const client: Client = {
      id: 'client1',
      sessionId: 's1',
      state: ClientState.JOINED,
      view,
      raw: (data: Uint8Array) => {
        receivedFrames.push(data);
      },
    } as any;

    // Initial patch
    serializer.applyPatches([client]);

    // Tick 1 view change
    state.secret = 'secret-value-1';
    serializer.applyPatches([client]);

    expect(receivedFrames.length).toBe(2);
    const frame1 = receivedFrames[1];
    const frame1Snapshot = Buffer.from(frame1);

    // Tick 2 view change
    state.secret = 'a-much-longer-secret-value-overwriting-buffer-2';
    serializer.applyPatches([client]);

    expect(receivedFrames.length).toBe(3);
    expect(Buffer.compare(Buffer.from(frame1), frame1Snapshot)).toBe(0);
  });
});
