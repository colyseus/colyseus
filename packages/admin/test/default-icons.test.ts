import assert from 'assert';
import { describe, it } from 'node:test';
import { iconForTableName } from '../src-backend/default-icons.ts';

describe('iconForTableName', () => {
  it('identity / social', () => {
    assert.equal(iconForTableName('users'), 'user');
    assert.equal(iconForTableName('players'), 'user');
    assert.equal(iconForTableName('characters'), 'user');
    assert.equal(iconForTableName('guilds'), 'team');
    assert.equal(iconForTableName('teams'), 'team');
    assert.equal(iconForTableName('clans'), 'team');
  });

  it('economy / inventory', () => {
    assert.equal(iconForTableName('items'), 'shopping');
    assert.equal(iconForTableName('player_items'), 'appstore');
    assert.equal(iconForTableName('inventory'), 'appstore');
    assert.equal(iconForTableName('orders'), 'shopping-cart');
    assert.equal(iconForTableName('payments'), 'credit-card');
    assert.equal(iconForTableName('rewards'), 'gift');
  });

  it('progression', () => {
    assert.equal(iconForTableName('leaderboards'), 'trophy');
    assert.equal(iconForTableName('leaderboard_entries'), 'trophy');
    assert.equal(iconForTableName('achievements'), 'trophy');
    assert.equal(iconForTableName('quests'), 'flag');
  });

  it('saves / configs / events', () => {
    assert.equal(iconForTableName('cloud_saves'), 'cloud');
    assert.equal(iconForTableName('saves'), 'save');
    assert.equal(iconForTableName('configs'), 'setting');
    assert.equal(iconForTableName('settings'), 'setting');
    assert.equal(iconForTableName('timed_events'), 'clock-circle');
    assert.equal(iconForTableName('events'), 'calendar');
    assert.equal(iconForTableName('sessions'), 'clock-circle');
  });

  it('analytics — compound names beat generic suffix rules', () => {
    // analytics_events must NOT match the generic `events` rule
    assert.equal(iconForTableName('analytics_events'), 'line-chart');
    assert.equal(iconForTableName('analytics'), 'line-chart');
    assert.equal(iconForTableName('metrics'), 'line-chart');
    assert.equal(iconForTableName('logs'), 'file-text');
  });

  it('moderation / RBAC — order matters: mod_assignments vs roles', () => {
    assert.equal(iconForTableName('user_roles'), 'safety');
    assert.equal(iconForTableName('mod_assignments'), 'safety');
    assert.equal(iconForTableName('permissions'), 'key');
    assert.equal(iconForTableName('tokens'), 'key');
    assert.equal(iconForTableName('bans'), 'stop');
    assert.equal(iconForTableName('reports'), 'warning');
  });

  it('communication', () => {
    assert.equal(iconForTableName('messages'), 'message');
    assert.equal(iconForTableName('notifications'), 'bell');
  });

  it('game world', () => {
    assert.equal(iconForTableName('rooms'), 'build');
    assert.equal(iconForTableName('matches'), 'thunderbolt');
    assert.equal(iconForTableName('maps'), 'environment');
  });

  it('strips colyseus_ prefix before matching — built-in tables get the right icon', () => {
    assert.equal(iconForTableName('colyseus_users'), 'user');
    assert.equal(iconForTableName('colyseus_leaderboards'), 'trophy');
    assert.equal(iconForTableName('colyseus_analytics_events'), 'line-chart');
    assert.equal(iconForTableName('colyseus_cloud_saves'), 'cloud');
  });

  it('falls back to "database" for unknown names', () => {
    assert.equal(iconForTableName('widgets'), 'database');
    assert.equal(iconForTableName('an_unrelated_thing'), 'database');
  });
});
