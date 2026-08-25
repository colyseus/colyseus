import assert from 'assert';
import { describe, it } from 'node:test';
import { humanize } from '../src-backend/display/humanize.ts';

describe('humanize', () => {
  it('matches the spec for built-in GameDatabase tables', () => {
    assert.equal(humanize('users'), 'Users');
    assert.equal(humanize('configs'), 'Configs');
    assert.equal(humanize('cloudSaves'), 'Cloud Saves');
    assert.equal(humanize('leaderboards'), 'Leaderboards');
    assert.equal(humanize('leaderboardEntries'), 'Leaderboard Entries');
    assert.equal(humanize('analyticsEvents'), 'Analytics Events');
    assert.equal(humanize('roles'), 'Roles');
    assert.equal(humanize('userNotes'), 'User Notes');
    assert.equal(humanize('adminAudit'), 'Admin Audit');
  });

  it('handles snake_case', () => {
    assert.equal(humanize('user_roles'), 'User Roles');
    assert.equal(humanize('cloud_saves'), 'Cloud Saves');
    assert.equal(humanize('analytics_events'), 'Analytics Events');
  });

  it('handles single-word names', () => {
    assert.equal(humanize('guilds'), 'Guilds');
    assert.equal(humanize('Guilds'), 'Guilds');
  });

  it('handles ALL_CAPS prefixes correctly', () => {
    assert.equal(humanize('APIKeys'), 'API Keys');
    assert.equal(humanize('XMLHttpRequest'), 'XML Http Request');
    // Limitation: a single-letter "acronym" inside Pascal case (`OAuth`) gets split.
    // Documented; users can override via defineAdminResource({ label }).
    assert.equal(humanize('OAuthTokens'), 'O Auth Tokens');
  });

  it('collapses extra whitespace + underscores', () => {
    assert.equal(humanize('  user__roles  '), 'User Roles');
  });

  it('returns "" for empty input', () => {
    assert.equal(humanize(''), '');
  });
});
