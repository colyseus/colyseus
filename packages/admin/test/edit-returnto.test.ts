/**
 * `safeReturnTo` defends the EditPage's post-Save redirect against a
 * hostile `?returnTo=` value (open-redirect class). Exported from
 * `pages/edit` for direct unit testing — the EditPage uses it on the
 * query-string value before passing to react-router's `navigate`.
 */
import assert from 'assert';
import { describe, it } from 'node:test';
import { safeReturnTo } from '../src/pages/edit.tsx';

describe('EditPage safeReturnTo', () => {
  it('returns the fallback when no returnTo query param is present', () => {
    assert.strictEqual(safeReturnTo(null, '/users'), '/users');
    assert.strictEqual(safeReturnTo('', '/users'), '/users');
  });

  it('accepts a same-origin absolute path', () => {
    assert.strictEqual(
      safeReturnTo('/users/show/U1/cloudSaves', '/cloudSaves'),
      '/users/show/U1/cloudSaves',
    );
  });

  it('rejects protocol-relative URLs (open-redirect defense)', () => {
    // `//evil.com/x` would let an attacker craft an edit link that
    // sends the user offsite after Save.
    assert.strictEqual(safeReturnTo('//evil.example/x', '/cloudSaves'), '/cloudSaves');
  });

  it('rejects absolute http(s) URLs', () => {
    assert.strictEqual(safeReturnTo('https://evil.example/x', '/cloudSaves'), '/cloudSaves');
    assert.strictEqual(safeReturnTo('http://evil.example/x', '/cloudSaves'), '/cloudSaves');
  });

  it('rejects relative paths without a leading slash', () => {
    assert.strictEqual(safeReturnTo('cloudSaves', '/cloudSaves'), '/cloudSaves');
  });
});
