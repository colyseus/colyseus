import './util';
import { afterEach, describe, test } from 'vitest';
import { assert } from 'chai';

import { debugOverlayActive, publishDebug, setDebugReceiver } from '../src/debug-channel.ts';
import * as scriptTagChannel from '../src/debug-channel.umd.ts';

const g = globalThis as { __colyseusDebug?: unknown };

// Drain and detach, so a test's buffered publishes don't replay into the next.
function resetChannel() {
    setDebugReceiver(() => {});
    setDebugReceiver(undefined);
}

describe('debug channel', () => {
    afterEach(() => {
        resetChannel();
        delete g.__colyseusDebug;
    });

    test('publishing without the overlay leaves nothing on globalThis', () => {
        const before = Object.getOwnPropertyNames(globalThis);
        publishDebug('room', { state: 'secret' });
        assert.deepEqual(Object.getOwnPropertyNames(globalThis), before);
    });

    test('a global planted by a page script is never handed a room', () => {
        const seen: unknown[] = [];
        const plant = (_channel: string, handle: object) => { seen.push(handle); };
        g.__colyseusDebug = Object.assign(plant, { publish: plant });

        publishDebug('room', {});

        assert.deepEqual(seen, []);
        assert.isFalse(debugOverlayActive());
    });

    test('replays publishes that beat the overlay, then goes live', () => {
        const room = {};
        const predict = {};
        publishDebug('room', room);
        publishDebug('predict', predict);

        const seen: Array<[string, object]> = [];
        setDebugReceiver((channel, handle) => { seen.push([channel, handle]); });
        assert.deepEqual(seen, [['room', room], ['predict', predict]]);
        assert.strictEqual(seen[0][1], room);

        const late = {};
        publishDebug('room', late);
        assert.lengthOf(seen, 3);
        assert.strictEqual(seen[2][1], late);
    });

    test('replays once', () => {
        publishDebug('room', {});
        setDebugReceiver(() => {});

        const seen: object[] = [];
        setDebugReceiver((_channel, handle) => { seen.push(handle); });
        assert.lengthOf(seen, 0);
    });

    test('keeps only the newest publishes while no overlay loads', () => {
        const rooms = Array.from({ length: 70 }, () => ({}));
        for (const room of rooms) { publishDebug('room', room); }

        const seen: object[] = [];
        setDebugReceiver((_channel, handle) => { seen.push(handle); });
        assert.lengthOf(seen, 64);
        assert.strictEqual(seen[0], rooms[6]);
        assert.strictEqual(seen[63], rooms[69]);
    });

    test('a buffered publish does not read as a live overlay', () => {
        publishDebug('room', {});
        assert.isFalse(debugOverlayActive());
        setDebugReceiver(() => {});
        assert.isTrue(debugOverlayActive());
    });
});

describe('debug channel (script-tag builds)', () => {
    afterEach(() => { delete g.__colyseusDebug; });

    test('without dist/debug.js there is no global, and publishes go nowhere', () => {
        const before = Object.getOwnPropertyNames(globalThis);
        scriptTagChannel.publishDebug('room', {});
        assert.deepEqual(Object.getOwnPropertyNames(globalThis), before);
        assert.isFalse(scriptTagChannel.debugOverlayActive());
    });

    test('dist/debug.js receives what is published after it loads', () => {
        const seen: object[] = [];
        scriptTagChannel.setDebugReceiver((_channel, handle) => { seen.push(handle); });
        assert.isTrue(scriptTagChannel.debugOverlayActive());

        const room = {};
        scriptTagChannel.publishDebug('room', room);
        assert.lengthOf(seen, 1);
        assert.strictEqual(seen[0], room);
    });
});
