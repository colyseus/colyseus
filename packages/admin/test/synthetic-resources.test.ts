/**
 * Synthetic resources powering the dynamic linkTo's "off-catalog"
 * targets. Right now the only entry is `rooms` (the live-room
 * inspector lives at /rooms/:id, not the standard /:resource/show/:id
 * route), but the abstraction exists so adding more virtual surfaces
 * — e.g. a future "jobs" or "queues" inspector — stays a one-line
 * change.
 */
import assert from 'assert';
import { describe, it } from 'node:test';
import {
  SYNTHETIC_SHOW_PATHS,
  syntheticShowPath,
} from '../src/pages/internals/synthetic-resources.ts';

describe('synthetic resources (off-catalog dynamic linkTo targets)', () => {
  it('builds a /rooms/:id path for the live-room inspector', () => {
    assert.strictEqual(syntheticShowPath('rooms', 'abc123'), '/rooms/abc123');
  });

  it('returns undefined for resource names that are not synthetic', () => {
    // `users` is a real catalog resource — its show URL is built by
    // formatCell's standard catalog path, not by this map. Returning
    // undefined here is the signal that lets formatCell fall back.
    assert.strictEqual(syntheticShowPath('users', 'abc'), undefined);
    assert.strictEqual(syntheticShowPath('auth', 'login'), undefined);
    assert.strictEqual(syntheticShowPath('', 'abc'), undefined);
  });

  it('URL-encodes ids that contain reserved or unsafe characters', () => {
    // RoomIds are usually alphanumeric, but the encoder is the
    // contract that makes deep-links safe even when the upstream
    // changes (or a custom roomId carries a slash, space, etc.).
    assert.strictEqual(syntheticShowPath('rooms', 'a/b c'), '/rooms/a%2Fb%20c');
  });

  it('exports SYNTHETIC_SHOW_PATHS as a flat name → builder map', () => {
    // Exposed (in addition to syntheticShowPath) so the renderer can
    // do a quick `in` check before calling, matching the catalog
    // resource probe — keeps the dynamic-link resolver branchless.
    assert.ok('rooms' in SYNTHETIC_SHOW_PATHS);
    assert.strictEqual(typeof SYNTHETIC_SHOW_PATHS.rooms, 'function');
  });
});
