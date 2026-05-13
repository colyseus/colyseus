/**
 * Shared `?returnTo=` helpers — single source of truth for the encoding
 * + same-origin guard used by edit forms, the live-room inspector,
 * and any future detail page that wants the user to land back where
 * they came from.
 */
import assert from 'assert';
import { describe, it } from 'node:test';
import { safeReturnTo, withReturnTo } from '../src/pages/internals/return-to.ts';

describe('withReturnTo', () => {
  it('returns the bare path when no returnTo is given', () => {
    assert.strictEqual(withReturnTo('/rooms/abc'), '/rooms/abc');
    assert.strictEqual(withReturnTo('/rooms/abc', undefined), '/rooms/abc');
    assert.strictEqual(withReturnTo('/rooms/abc', ''), '/rooms/abc');
  });

  it('URL-encodes the returnTo value (slashes, query chars, etc.)', () => {
    const url = withReturnTo('/rooms/abc', '/users/show/U1?tab=sessions');
    assert.strictEqual(
      url,
      '/rooms/abc?returnTo=%2Fusers%2Fshow%2FU1%3Ftab%3Dsessions',
    );
  });

  it('round-trips: decodeURIComponent restores the original returnTo', () => {
    const original = '/users/show/U1/cloudSaves';
    const url = withReturnTo('/rooms/abc', original);
    const recovered = decodeURIComponent(url.split('returnTo=')[1] ?? '');
    assert.strictEqual(recovered, original);
  });
});

describe('safeReturnTo (single source of truth)', () => {
  it('returns the fallback when no returnTo is present', () => {
    assert.strictEqual(safeReturnTo(null, '/rooms'), '/rooms');
    assert.strictEqual(safeReturnTo('', '/rooms'), '/rooms');
  });

  it('accepts a same-origin absolute path', () => {
    assert.strictEqual(
      safeReturnTo('/users/show/U1', '/rooms'),
      '/users/show/U1',
    );
  });

  it('rejects protocol-relative URLs (open-redirect defense)', () => {
    assert.strictEqual(safeReturnTo('//evil.example/x', '/rooms'), '/rooms');
  });

  it('rejects absolute http(s) URLs', () => {
    assert.strictEqual(safeReturnTo('https://evil.example/x', '/rooms'), '/rooms');
    assert.strictEqual(safeReturnTo('http://evil.example/x', '/rooms'), '/rooms');
  });

  it('rejects relative paths without a leading slash', () => {
    assert.strictEqual(safeReturnTo('rooms', '/rooms'), '/rooms');
  });
});
