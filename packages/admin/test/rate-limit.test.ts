/**
 * Unit tests for the in-memory token-bucket rate limiter. The auth
 * endpoints integration is covered end-to-end by the example admin-e2e
 * suite — this file pins down the limiter contract itself: burst
 * capacity, refill rate, retry-after header, key isolation, and the
 * `ipFromHeaders` selector.
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { createTokenBucketLimiter, ipFromHeaders } from '../src-backend/auth/rate-limit.ts';

describe('createTokenBucketLimiter', () => {
  it('allows up to `capacity` calls then blocks with 429', async () => {
    const limiter = createTokenBucketLimiter({ capacity: 3, refillPerSec: 0 });
    assert.equal(await limiter.check('k'), null);
    assert.equal(await limiter.check('k'), null);
    assert.equal(await limiter.check('k'), null);
    const blocked = await limiter.check('k') as Response;
    assert.ok(blocked instanceof Response);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '1');
  });

  it('separates buckets per key', async () => {
    const limiter = createTokenBucketLimiter({ capacity: 1, refillPerSec: 0 });
    assert.equal(await limiter.check('a'), null);
    assert.equal(await limiter.check('b'), null); // independent
    assert.ok((await limiter.check('a')) instanceof Response);
    assert.ok((await limiter.check('b')) instanceof Response);
  });

  it('respects custom retryAfterSec', async () => {
    const limiter = createTokenBucketLimiter({
      capacity: 1, refillPerSec: 0, retryAfterSec: 42,
    });
    await limiter.check('k');
    const blocked = await limiter.check('k') as Response;
    assert.equal(blocked.headers.get('retry-after'), '42');
    const body = await blocked.json() as { retryAfterSec: number };
    assert.equal(body.retryAfterSec, 42);
  });

  it('refills tokens over time', async () => {
    const limiter = createTokenBucketLimiter({ capacity: 2, refillPerSec: 100 });
    await limiter.check('k');
    await limiter.check('k');
    assert.ok((await limiter.check('k')) instanceof Response, 'should be empty');
    // Wait long enough to refill at least one token (100/sec → 10ms each).
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(await limiter.check('k'), null);
  });
});

describe('ipFromHeaders', () => {
  it('reads X-Forwarded-For and takes the leftmost address', () => {
    const get = (k: string) =>
      k === 'x-forwarded-for' ? '203.0.113.5, 10.0.0.1, 10.0.0.2' : null;
    assert.equal(ipFromHeaders(get), '203.0.113.5');
  });

  it('falls back to X-Real-IP when X-Forwarded-For is absent', () => {
    const get = (k: string) =>
      k === 'x-real-ip' ? '203.0.113.7' : null;
    assert.equal(ipFromHeaders(get), '203.0.113.7');
  });

  it('returns "unknown" when no recognized header is present', () => {
    assert.equal(ipFromHeaders(() => null), 'unknown');
  });
});
