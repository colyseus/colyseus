import './util';
import { describe, test } from 'vitest';
import { assert } from 'chai';

import { schema, t, Encoder, Reflection, type SchemaType } from '@colyseus/schema';

import { SchemaSerializer } from '../src/serializer/SchemaSerializer.ts';

// setState = "make the client state equal this snapshot": a full state is
// authoritative, so entries it doesn't contain are reconciled away (the old
// additive behavior left ghosts after a reconnect). Patches stay additive.

const Entity = schema({ name: t.string().default(''), hp: t.number().default(0) }, 'ResyncEntity');
type Entity = SchemaType<typeof Entity>;
const State = schema({ entities: t.map(Entity) }, 'ResyncState');
type State = SchemaType<typeof State>;

describe('SchemaSerializer setState reconciliation', () => {
    test('setState prunes ghosts and keeps survivor identity; patches stay additive', () => {
        const state = new State();
        const encoder = new Encoder(state);
        state.entities.set('e1', new Entity().assign({ name: 'one', hp: 10 }));
        state.entities.set('e2', new Entity().assign({ name: 'two', hp: 20 }));

        const serializer = new SchemaSerializer();
        serializer.handshake(Reflection.encode(encoder));
        serializer.setState(encoder.encodeAll());
        const decoded = serializer.getState() as State;
        assert.strictEqual(decoded.entities.size, 2);
        const survivor = decoded.entities.get('e1');

        // offline: e2 dies; its DELETE patch is never delivered
        state.entities.delete('e2');
        encoder.encode(); encoder.discardChanges();

        // rejoin full state: ghost reconciled away, survivor keeps identity
        serializer.setState(encoder.encodeAll());
        assert.strictEqual(decoded.entities.size, 1);
        assert.strictEqual(decoded.entities.get('e1'), survivor);

        // patches remain additive: one not mentioning e1 must not touch it
        state.entities.set('e3', new Entity().assign({ name: 'three' }));
        serializer.patch(encoder.encode());
        encoder.discardChanges();
        assert.strictEqual(decoded.entities.size, 2);
        assert.strictEqual(decoded.entities.get('e1'), survivor);
    });
});
