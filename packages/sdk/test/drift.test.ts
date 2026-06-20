import './util';
import { describe, test } from 'vitest';
import { assert } from 'chai';

import { newDrift, updateDrift, resetDrift, classifyDrift } from '../src/predict/drift.ts';

describe('drift telemetry (rolling reconcile drift)', () => {
    test('newDrift is zeroed', () => {
        const d = newDrift();
        assert.equal(d.ema, 0);
        assert.equal(d.peak, 0);
    });

    test('EMA approaches the fed magnitude at alpha=0.1 (the persistent/divergence component)', () => {
        const d = newDrift();
        updateDrift(d, 10);                 // 0 + (10-0)*0.1
        assert.closeTo(d.ema, 1, 1e-9);
        updateDrift(d, 10);                 // 1 + (10-1)*0.1
        assert.closeTo(d.ema, 1.9, 1e-9);
    });

    test('peak jumps to a spike, then decays by 0.9 on quiet reconciles (the jitter component)', () => {
        const d = newDrift();
        updateDrift(d, 9);                  // max(9, 0)
        assert.equal(d.peak, 9);
        updateDrift(d, 0);                  // max(0, 9*0.9)
        assert.closeTo(d.peak, 8.1, 1e-9);
        updateDrift(d, 0);                  // 8.1*0.9
        assert.closeTo(d.peak, 7.29, 1e-9);
    });

    test('a higher spike overrides the decaying peak', () => {
        const d = newDrift();
        updateDrift(d, 5);
        updateDrift(d, 0);                  // peak 4.5
        updateDrift(d, 12);                 // max(12, 4.05)
        assert.equal(d.peak, 12);
    });

    test('resetDrift zeroes both', () => {
        const d = newDrift();
        updateDrift(d, 7);
        resetDrift(d);
        assert.equal(d.ema, 0);
        assert.equal(d.peak, 0);
    });
});

describe('classifyDrift (verdict)', () => {
    test('matched when ema and peak are within the float-noise floor', () => {
        assert.equal(classifyDrift({ ema: 0, peak: 0 }), 'matched');
        assert.equal(classifyDrift({ ema: 1e-4, peak: 5e-4 }), 'matched');
    });

    test('jitter when peak spikes but the persistent ema stays low', () => {
        assert.equal(classifyDrift({ ema: 1e-4, peak: 5 }), 'jitter');
    });

    test('diverging when the ema (persistent component) is elevated', () => {
        assert.equal(classifyDrift({ ema: 2, peak: 5 }), 'diverging');
        assert.equal(classifyDrift({ ema: 2, peak: 2 }), 'diverging');
    });

    test('a tolerance raises the floor — the dev-declared scale, no magic number', () => {
        // ema 0.5 reads diverging against the default float-noise floor…
        assert.equal(classifyDrift({ ema: 0.5, peak: 0.5 }), 'diverging');
        // …but matched under a tolerance of 1 (both 0.5 < 1)…
        assert.equal(classifyDrift({ ema: 0.5, peak: 0.5 }, 1), 'matched');
        // …and a spike above the tolerance reads jitter while ema stays under it.
        assert.equal(classifyDrift({ ema: 0.5, peak: 1.5 }, 1), 'jitter');
    });
});
