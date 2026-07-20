import './util';
import { describe, test, afterEach, vi } from 'vitest';
import { assert } from 'chai';

import { InputEncoder } from '@colyseus/schema/input';
import { schema, t, type SchemaType } from '@colyseus/schema';

import { InputHandleImpl, type InputHandleHost } from '../src/input/InputHandle.ts';

const MoveInput = schema({
    x: t.number().default(0),
    y: t.number().default(0),
});
type MoveInput = SchemaType<typeof MoveInput>;

function makeHandle() {
    const host: InputHandleHost = {
        connection: {
            isOpen: true,
            send(_data: Uint8Array) { /* discard */ },
            sendUnreliable(_data: Uint8Array) { /* discard */ },
        } as any,
        clock: undefined,
    };
    const instance = new MoveInput();
    const encoder = new InputEncoder(instance as any, { mode: 'reliable' });
    return new InputHandleImpl<MoveInput>(host, instance, encoder, {});
}

// A live receiver has no `__buffer` (see debugOverlayActive); the pre-load
// publish buffer DOES — the diagnostic must stay off for that one.
function installOverlay(live = true): void {
    (globalThis as any).__colyseusDebug = live
        ? { publish: () => { /* live receiver */ } }
        : { publish: () => { /* buffered */ }, __buffer: [] };
}

//
// Unknown-field writes on `input.data` (dev diagnostic): declared fields go
// through prototype setters into `$values` and never create own keys, so an
// own enumerable string key not in the schema metadata is a write that will
// never be encoded — warn once per key while the debug overlay is live.
//
describe('input.data unknown-field warning', () => {
    afterEach(() => {
        delete (globalThis as any).__colyseusDebug;
        vi.restoreAllMocks();
    });

    test('declared writes stay silent', () => {
        installOverlay();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const handle = makeHandle();
        handle.data.x = 1; handle.data.y = 2;
        handle.send();
        assert.equal(warn.mock.calls.length, 0);
    });

    test('unknown write warns once, naming the key and the class', () => {
        installOverlay();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const handle = makeHandle();
        (handle.data as any).seed = 42;
        handle.send();
        assert.equal(warn.mock.calls.length, 1);
        assert.include(warn.mock.calls[0][0], '"seed"');
        assert.include(warn.mock.calls[0][0], 'not a declared field');
        handle.send();                             // no re-warn on later sends
        assert.equal(warn.mock.calls.length, 1);
        (handle.data as any).dt = 0.016;           // a NEW unknown key still warns
        handle.send();
        assert.equal(warn.mock.calls.length, 2);
        assert.include(warn.mock.calls[1][0], '"dt"');
    });

    test('silent when the overlay is absent or only pre-load buffered', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const handle = makeHandle();
        (handle.data as any).seed = 42;
        handle.send();                             // no overlay at all
        installOverlay(false);                     // pre-load buffer ≠ live receiver
        handle.send();
        assert.equal(warn.mock.calls.length, 0);
    });
});
