import crypto from 'crypto';

type HashPasswordAlgorithm = (password: string, salt: string) => Promise<string> | string;
type HashAlgorithm = 'sha1' | 'scrypt' | string;

/**
 * Password hashing utility.
 *
 * Wire format:  `<algorithm>$<salt-hex>$<hash-hex>`  — e.g.
 *   `scrypt$8f1f...$3d2a...`
 *
 * Each call to `make()` generates a fresh random salt, so two users with
 * the same password produce DIFFERENT stored hashes. `verify()` parses the
 * algorithm + salt off the stored string and recomputes — no shared global
 * salt needed.
 *
 * Legacy compatibility: a stored value that doesn't contain a `$` is
 * treated as the pre-format raw hash (the deprecated `AUTH_SALT`-shared
 * scheme). `verify()` falls back to that path so existing rows keep
 * authenticating. Re-hashing on next login is the caller's choice — see
 * `isLegacy()`.
 */
export class Hash {
  /** Algorithm used when `make()` is called. Stored hashes carry their own algorithm tag so verify works across switches. */
  static algorithm: HashAlgorithm = 'scrypt';

  /** Bytes of randomness for the per-password salt (32-char hex string). */
  static saltBytes = 16;

  static algorithms: { [id: HashAlgorithm]: HashPasswordAlgorithm } = {
    sha1: (password, salt) =>
      crypto.createHash('sha1').update(password + salt).digest('hex'),
    scrypt: (password, salt) =>
      new Promise<string>((resolve, reject) => {
        crypto.scrypt(password, salt, 64, (err, derivedKey) => {
          if (err) { reject(err); } else { resolve(derivedKey.toString('hex')); }
        });
      }),
  };

  /**
   * Hash `password` for storage. Always uses a fresh random salt unless
   * one is provided explicitly (provided salts are mostly for test
   * determinism — production code should let the salt be random).
   *
   * Returns a self-contained `<algo>$<salt>$<hash>` string. Pair with
   * `verify()`; never compare two `make()` outputs with `===`.
   */
  static async make(password: string, salt?: string): Promise<string> {
    const saltHex = salt ?? crypto.randomBytes(this.saltBytes).toString('hex');
    const algo = this.algorithm;
    const fn = this.algorithms[algo];
    if (!fn) { throw new Error(`[Hash] unknown algorithm "${algo}"`); }
    const hash = await fn(password, saltHex);
    return `${algo}$${saltHex}$${hash}`;
  }

  /**
   * Constant-time verify of `password` against a previously-stored value.
   * Accepts both the new `<algo>$<salt>$<hash>` format and the legacy
   * raw-hex format (which uses `process.env.AUTH_SALT` as a shared salt).
   *
   * Returns `false` for any malformed input rather than throwing — auth
   * callers should treat the result as "did this credential match?" and
   * nothing else.
   */
  static async verify(password: string, stored: string | null | undefined): Promise<boolean> {
    if (!stored) { return false; }
    const parsed = this.parseStored(stored);
    const fn = this.algorithms[parsed.algorithm];
    if (!fn) { return false; }
    let computed: string;
    try {
      computed = await fn(password, parsed.salt);
    } catch {
      return false;
    }
    return timingSafeEqualHex(computed, parsed.hash);
  }

  /**
   * Does `stored` use the pre-format raw-hex scheme? Useful for "verify
   * → lazily re-hash on next login" flows: after a successful `verify()`
   * call against a legacy value, the caller can re-run `make()` and
   * persist the upgrade.
   */
  static isLegacy(stored: string | null | undefined): boolean {
    if (!stored) { return false; }
    return !stored.includes('$');
  }

  private static parseStored(stored: string): { algorithm: HashAlgorithm; salt: string; hash: string } {
    const parts = stored.split('$');
    if (parts.length === 3 && parts[0] && parts[0] in this.algorithms) {
      return { algorithm: parts[0], salt: parts[1]!, hash: parts[2]! };
    }
    // Legacy raw-hex — use the env-shared salt + the currently-configured algorithm.
    return {
      algorithm: this.algorithm,
      salt: process.env.AUTH_SALT || '## SALT ##',
      hash: stored,
    };
  }
}

/**
 * Constant-time equality for two hex strings of arbitrary length.
 * Returns false (without ever calling timingSafeEqual) when the lengths
 * differ — required by the underlying API. The length check is itself
 * O(1) so the leak is just "the hashes are different lengths", which
 * implies different algorithms (already public via the prefix).
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) { return false; }
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
