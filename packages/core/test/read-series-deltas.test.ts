// @vitest-environment node
/** `readSeriesDeltas()`: the slot count `k` comes from the client. */
import { describe, it, expect } from 'vitest';
import { readSeriesDeltas } from '../src/input/RoomInput.ts';

describe('readSeriesDeltas', () => {
  it('rebuilds the series from the newest anchor', () => {
    expect(readSeriesDeltas(Buffer.from([10, 5]), { offset: 0 }, 3, 100)).toEqual([85, 90, 100]);
  });

  it('rejects a slot count the packet cannot hold', () => {
    const buf = Buffer.from([10, 5]);
    // undefined: what decode.number returns on a truncated packet
    for (const k of [4, 0, NaN, undefined as any]) {
      expect(() => readSeriesDeltas(buf, { offset: 0 }, k, 100)).toThrow(RangeError);
    }
  });
});
