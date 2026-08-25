import './util';
import { describe, test } from 'vitest';
import { assert } from 'chai';

import { InputEncoder } from '@colyseus/schema/input';
import { schema, t, type SchemaType } from '@colyseus/schema';

import { InputHandleImpl, type InputHandleHost } from '../src/input/InputHandle.ts';
import { Reconciler } from '../src/predict.ts';

// Regression guard for the automatic-reconnect path:
//   room.onReconnect → (SDK) inputHandle.reset() → controllers follow via `epoch`
// The server allocates a FRESH input buffer (consumed counter restarts at 0),
// so the handle resets to realign seqs; rollback controllers poll the handle's
// `epoch` and self-reset — no app wiring. This locks in that `reset()` clearing
// `_sendTimes` (the fix) does NOT regress what prediction reads off the handle.

const MoveInput = schema({ x: t.number().default(0), y: t.number().default(0) });
type MoveInput = SchemaType<typeof MoveInput>;

function makeHandle() {
    const reliable: Uint8Array[] = [];
    const host: InputHandleHost = {
        connection: {
            get isOpen() { return true; },
            send(d: Uint8Array) { reliable.push(Uint8Array.from(d)); },
            sendUnreliable() {},
        } as any,
    };
    const instance = new MoveInput();
    const encoder = new InputEncoder(instance as any, { mode: 'reliable' });
    const handle = new InputHandleImpl(host, instance, encoder, { tickRate: 60 });
    return { handle, instance };
}

describe('fps-demo automatic-reconnect: inputHandle.reset() prediction invariant', () => {
    test('reset() drops the prediction backlog and restarts seqs cleanly', () => {
        const { handle, instance } = makeHandle();

        // Pre-reconnect: 3 inputs sent, server acked seq 2.
        for (let i = 1; i <= 3; i++) { instance.x = i; handle.send(); }
        handle.ackInput(2);
        assert.equal(handle.sentCount, 3);
        assert.equal(handle.lastProcessed, 2);
        assert.equal(handle.pendingCount, 1, 'seq 3 in flight pre-reconnect');
        assert.isDefined(handle.at(3), 'seq 3 buffered for replay pre-reconnect');

        // === Automatic reconnect (Room.ts onReconnect → inputHandle.reset()) ===
        handle.reset();

        // Prediction sees a clean slate: backlog gone, counters zeroed, no stale snapshot.
        assert.equal(handle.sentCount, 0);
        assert.equal(handle.lastProcessed, 0);
        assert.equal(handle.pendingCount, 0);
        assert.isUndefined(handle.at(1), 'no pre-reset snapshot survives reset');
        assert.isUndefined(handle.at(3));

        // Post-reconnect prediction is fully functional: seqs restart at 1, the
        // replay ring + send-time ring both record fresh entries.
        instance.x = 10; handle.send();
        instance.x = 20; handle.send();
        assert.equal(handle.sentCount, 2, 'post-reconnect seqs restart from 1');
        assert.equal((handle.at(2) as any).x, 20, 'post-reconnect input snapshot is fresh, not stale');
        assert.isAtLeast(handle.ackInput(1), 0, 'post-reconnect send-time ring records fresh stamps');
        assert.equal(handle.lastProcessed, 1);
    });

    test('a late ack for a PRE-reset seq injects no RTT (the _sendTimes.fill fix)', () => {
        const { handle, instance } = makeHandle();
        for (let i = 1; i <= 3; i++) { instance.x = i; handle.send(); }
        handle.ackInput(1);

        handle.reset(); // reconnect

        // Old connection's in-flight ack lands on the fresh handle. It must NOT
        // surface the pre-reset send-time as a bogus RTT into the just-reset
        // clock (which would corrupt the EMA seed). -1 = "no sample".
        assert.equal(handle.ackInput(2), -1, 'stale pre-reset ack → no RTT sample');
    });

    test('a rollback controller follows the reset automatically (epoch poll, no wiring)', () => {
        const { handle, instance } = makeHandle();
        const PlayerState = schema({ x: t.number() });
        const state = new PlayerState();
        state.x = 0;
        const recon = new Reconciler<{ x: number }, MoveInput>(state, {
            input: handle,
            smoothMs: 0,
            step: (_ctx, s, cmd) => { s.x += cmd.x; },
        });

        // Pre-drop: 3 sends of +1, server acked 2 (truth x = 2).
        for (let i = 0; i < 3; i++) { instance.x = 1; handle.send(); }
        state.x = 2;
        handle.ackInput(2);
        recon.tick(0);
        assert.equal(recon.state.x, 3, 'acked truth + replayed seq 3');

        // Reconnect: the SDK resets the handle. NO app onReconnect wiring.
        handle.reset();
        recon.tick(16);
        assert.equal(recon.state.x, 2, 'controller self-reset off the epoch move');

        // Freeze regression: fresh post-reconnect sends must step prediction.
        instance.x = 5; handle.send();
        assert.equal(recon.state.x, 7, 'post-reconnect send predicted');
    });
});
