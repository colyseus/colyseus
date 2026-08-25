import './util';
import { describe, test, expect, vi } from 'vitest';
import { PredictedEvents } from '../src/predict/predictedEvents.ts';

function makeClock(start = 0) {
    let t = start, rtt = 50;
    return {
        clock: { serverNow: () => t, smoothedRtt: () => rtt },
        advance: (ms: number) => { t += ms; },
        setRtt: (r: number) => { rtt = r; },
    };
}

describe('PredictedEvents', () => {
    test('predict() returns a cancelable handle that drops the prediction', () => {
        const { clock } = makeClock();
        const pe = PredictedEvents.get<string>({ clock });
        const h = pe.predict('kill:1');
        expect(pe.has('kill:1')).toBe(true);
        expect(h.key).toBe('kill:1');

        h.cancel();
        expect(pe.has('kill:1')).toBe(false);
    });

    test('cancel() is a silent undo — does NOT fire onReject', () => {
        const onReject = vi.fn();
        const { clock } = makeClock();
        const pe = PredictedEvents.get<string>({ clock }, { onReject });
        pe.predict('kill:1').cancel();
        expect(onReject).not.toHaveBeenCalled();
    });

    test('reject(key) drops the prediction immediately and fires onReject', () => {
        const onReject = vi.fn();
        const { clock } = makeClock();
        const pe = PredictedEvents.get<string>({ clock }, { onReject });
        pe.predict('kill:1');

        pe.reject('kill:1');
        expect(pe.has('kill:1')).toBe(false);
        expect(onReject).toHaveBeenCalledTimes(1);
        expect(onReject).toHaveBeenCalledWith('kill:1');

        // idempotent: rejecting a gone key is a no-op
        pe.reject('kill:1');
        expect(onReject).toHaveBeenCalledTimes(1);
    });

    test('prune() evicts a stale prediction past TTL and fires onReject', () => {
        const onReject = vi.fn();
        const { clock, advance } = makeClock();
        // ttl: max(2*rtt, 600) with rtt=50 ⇒ 600ms
        const pe = PredictedEvents.get<string>({ clock }, { onReject });
        pe.predict('kill:1');

        advance(500);
        pe.prune();
        expect(pe.has('kill:1')).toBe(true);   // within TTL

        advance(200);                          // 700ms > 600
        pe.prune();
        expect(pe.has('kill:1')).toBe(false);
        expect(onReject).toHaveBeenCalledWith('kill:1');
    });

    test('confirm() is a silent correct-prediction drop (no onReject)', () => {
        const onReject = vi.fn();
        const { clock } = makeClock();
        const pe = PredictedEvents.get<string>({ clock }, { onReject });
        pe.predict('kill:1');
        pe.confirm('kill:1');
        expect(pe.has('kill:1')).toBe(false);
        expect(onReject).not.toHaveBeenCalled();
    });

    test('accept() exempts the prediction from TTL eviction', () => {
        const onReject = vi.fn();
        const { clock, advance } = makeClock();
        const pe = PredictedEvents.get<string>({ clock }, { onReject });
        const h = pe.predict('kill:1');
        h.accept();                            // server confirmed — keep it, disarm TTL

        advance(5000);                         // way past TTL
        pe.prune();
        expect(pe.has('kill:1')).toBe(true);   // still here — never TTL-pruned
        expect(onReject).not.toHaveBeenCalled();

        // observing the authoritative schema change later drops it cleanly
        pe.confirm('kill:1');
        expect(pe.has('kill:1')).toBe(false);
    });
});
