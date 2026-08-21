// @vitest-environment node
/**
 * `onMessage()` takes any Standard Schema validator, so the playground must
 * describe them all — and never break a room join over one it can't.
 * (github.com/colyseus/colyseus/issues/955)
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Room, ClientState } from '@colyseus/core';
import { toJSONSchema } from '../src-backend/json-schema';
import { applyMonkeyPatch } from '../src-backend/colyseus.ext';

// `~standard.jsonSchema`, as zod >= 4.2 / arktype / effect / sury expose it
const standardJSON = (vendor: string, jsonSchema: any) => ({
  '~standard': {
    version: 1, vendor,
    jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
  },
});

// a validator with no way to describe itself (valibot without its converter,
// or any library that hasn't adopted the JSON Schema interface)
const opaque = (vendor: string) => ({
  '~standard': { version: 1, vendor, validate: (value: any) => ({ value }) },
});

describe('toJSONSchema()', () => {
  it('converts zod through the Standard JSON Schema interface', async () => {
    const schema = await toJSONSchema(z.object({ x: z.number(), name: z.string().optional() }));
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual(['x', 'name']);
    expect(schema.required).toEqual(['x']);
  });

  it('converts any vendor exposing the interface', async () => {
    const jsonSchema = { type: 'object', properties: { x: { type: 'number' } } };
    for (const vendor of ['effect', 'arktype', 'sury', 'some-future-library']) {
      expect(await toJSONSchema(standardJSON(vendor, jsonSchema))).toEqual(jsonSchema);
    }
  });

  it('returns null instead of throwing', async () => {
    const throws = {
      '~standard': { version: 1, vendor: 'zod', jsonSchema: { input: () => { throw new Error('nope'); } } },
    };
    expect(await toJSONSchema(opaque('valibot'))).toBe(null); // converter not installed
    expect(await toJSONSchema(opaque('unknown'))).toBe(null);
    expect(await toJSONSchema(throws)).toBe(null);
    expect(await toJSONSchema({})).toBe(null);
    expect(await toJSONSchema(undefined)).toBe(null);
  });
});

describe('room join', () => {
  it('sends message types, describable or not', async () => {
    // the real _onJoin needs transport plumbing — stub it before the patch wraps it
    (Room.prototype as any)['_onJoin'] = async () => true;
    await applyMonkeyPatch();

    const room: any = new (class extends Room {})();
    room.onMessage('zod', z.object({ x: z.number() }), () => {});
    room.onMessage('effect', standardJSON('effect', { type: 'object' }), () => {});
    room.onMessage('opaque', opaque('valibot'), () => {});
    room.onMessage('no-validator', () => {});

    const sent: any[] = [];
    const client: any = { state: ClientState.JOINING, send: (type: string, message: any) => sent.push([type, message]) };
    await room._onJoin(client);

    expect(sent).toHaveLength(1);
    const [type, messages] = sent[0];
    expect(type).toBe('__playground_message_types');
    expect(messages.zod.properties.x).toEqual({ type: 'number' });
    expect(messages.effect).toEqual({ type: 'object' });
    expect(messages.opaque).toBe(null);
    expect(messages['no-validator']).toBe(null);
  });
});
