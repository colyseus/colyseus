/**
 * Pluggable rate limiter for the admin auth endpoints.
 *
 * The default implementation is an in-memory token bucket per key — fine
 * for single-process deployments. Multi-node operators should plug in a
 * shared store (Redis, etc.) via the `RateLimiter` interface; the
 * contract is intentionally tiny (one method, one response shape) so
 * any backend can satisfy it.
 *
 * Keys are caller-supplied strings — see `authEndpoints` for the
 * conventions: `login:<ip>:<email>` and `bootstrap:<ip>`. Including the
 * email in the login key means a single bad actor can only lock
 * themselves out of one account, not deny service to everyone.
 */

/**
 * Result of a single `check()` call. `null` means "allowed, proceed";
 * a 429 `Response` means "blocked, return this to the client".
 */
export interface RateLimiter {
  check(key: string): Promise<Response | null> | Response | null;
}

export interface TokenBucketOptions {
  /** Max tokens the bucket can hold. Determines burst capacity. */
  capacity: number;
  /** Tokens replenished per second (fractional values are fine). */
  refillPerSec: number;
  /** Value sent back in the `Retry-After` header on 429. Default `1`. */
  retryAfterSec?: number;
}

interface Bucket {
  tokens: number;
  /** Last refill time, in ms. */
  ts: number;
}

/**
 * In-memory token-bucket limiter. Each call to `check(key)` deducts one
 * token from `key`'s bucket; if empty, returns a 429.
 *
 *   const limiter = createTokenBucketLimiter({ capacity: 10, refillPerSec: 1/6 });
 *   // allows 10 quick attempts, then ~10/minute steady state.
 *
 * Buckets are stored in a `Map` and grow with the unique key count. In
 * practice that's bounded by the IP/email cardinality of attackers
 * (which a real attack will indeed try to inflate). For production
 * single-node use, pair with a periodic prune or swap in a Redis-backed
 * `RateLimiter`.
 */
export function createTokenBucketLimiter(opts: TokenBucketOptions): RateLimiter {
  const { capacity, refillPerSec } = opts;
  const retryAfter = opts.retryAfterSec ?? 1;
  const buckets = new Map<string, Bucket>();

  return {
    check(key: string): Response | null {
      const now = Date.now();
      let b = buckets.get(key);
      if (!b) {
        b = { tokens: capacity, ts: now };
        buckets.set(key, b);
      } else {
        const elapsed = (now - b.ts) / 1000;
        b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
        b.ts = now;
      }
      if (b.tokens < 1) {
        return new Response(
          JSON.stringify({ error: 'rate_limited', retryAfterSec: retryAfter }),
          {
            status: 429,
            headers: {
              'content-type': 'application/json',
              'retry-after': String(retryAfter),
            },
          },
        );
      }
      b.tokens -= 1;
      return null;
    },
  };
}

/**
 * Extract a stable rate-limit key from the request. Prefers the
 * leftmost `X-Forwarded-For` value (canonical proxy convention), falls
 * back to `x-real-ip`, then a literal `'unknown'` so misconfigured
 * deployments still degrade to "one big shared bucket" rather than
 * silently letting everyone through.
 */
export function ipFromHeaders(getHeader: (k: string) => string | null): string {
  const xff = getHeader('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) { return first; }
  }
  const xri = getHeader('x-real-ip');
  if (xri) { return xri.trim(); }
  return 'unknown';
}
