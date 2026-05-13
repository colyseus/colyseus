/**
 * `editUrl` builds the standalone-edit href used by the nested show
 * panel's Edit button. The `returnTo` query param is what the
 * EditPage reads back to bounce the user to the parent's tab after
 * Save — so the encoding has to be tight (full slash-escape).
 */
import assert from 'assert';
import { describe, it } from 'node:test';
import { editUrl } from '../src/pages/show.tsx';

describe('editUrl', () => {
  it('builds a bare edit URL when no returnTo is supplied', () => {
    assert.strictEqual(editUrl('cloudSaves', 'abc'), '/cloudSaves/edit/abc');
  });

  it('appends a fully URI-encoded returnTo query param', () => {
    const url = editUrl('cloudSaves', 'abc', '/users/show/U1/cloudSaves');
    assert.strictEqual(
      url,
      '/cloudSaves/edit/abc?returnTo=%2Fusers%2Fshow%2FU1%2FcloudSaves',
    );
  });

  it('URI-encodes the child id so composite-PK base64url ids survive', () => {
    // Composite PKs encode to base64url. The `=` padding is stripped by
    // the encoder, but other reserved chars (none in base64url's
    // alphabet) would still need protection. Confirm encodeURIComponent
    // is applied — a plus sign would otherwise be misread as a space.
    const url = editUrl('cloudSaves', 'a+b/c', '/x');
    assert.match(url, /\/cloudSaves\/edit\/a%2Bb%2Fc\?/);
  });
});
