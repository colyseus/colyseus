/**
 * GameDatabase.relations — FK metadata exposed for the admin engine.
 *
 * The metadata is static + purely descriptive: the admin layer uses it to
 * surface related rows on detail pages and to build paginated SELECTs for
 * the relations endpoint. Tests cover (1) the built-ins, (2) user
 * extensions via options, (3) override-by-name semantics.
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { GameDatabase } from '../src/index.ts';

describe('GameDatabase.relations', () => {
  it('exposes built-in FK relations between default tables', () => {
    const db = new GameDatabase();
    const userRels = db.relations.users;
    assert.ok(userRels, 'users source should have relations');

    const cloudSaves = userRels.find((r) => r.name === 'cloudSaves')!;
    assert.equal(cloudSaves.kind, 'many');
    assert.equal(cloudSaves.target, 'cloudSaves');
    assert.equal(cloudSaves.fk, 'userId');

    const role = userRels.find((r) => r.name === 'role')!;
    assert.equal(role.kind, 'one');
    assert.equal(role.target, 'roles');
  });

  it('declares back-references on the target side too', () => {
    const db = new GameDatabase();
    const cloudSaveRels = db.relations.cloudSaves;
    const back = cloudSaveRels.find((r) => r.name === 'user')!;
    assert.equal(back.kind, 'one');
    assert.equal(back.target, 'users');
    assert.equal(back.fk, 'userId');
  });

  it('merges user-supplied relations onto the built-ins', () => {
    const db = new GameDatabase({
      relations: {
        users: [
          { name: 'guilds', target: 'guildMembers', kind: 'many', fk: 'userId' },
        ],
        guildMembers: [
          { name: 'user', target: 'users', kind: 'one', fk: 'userId' },
        ],
      },
    });

    // Built-in users.cloudSaves still present
    assert.ok(db.relations.users.find((r) => r.name === 'cloudSaves'));
    // User-added users.guilds appended
    const guilds = db.relations.users.find((r) => r.name === 'guilds')!;
    assert.equal(guilds.target, 'guildMembers');
    // Whole new source table from user
    assert.ok(db.relations.guildMembers, 'user-defined source table should appear');
    assert.equal(db.relations.guildMembers[0]!.name, 'user');
  });

  it('user override by relation name replaces a built-in', () => {
    const db = new GameDatabase({
      relations: {
        users: [
          // Hide the chatty default by replacing it with one tagged for the
          // narrower admin view (kind/target unchanged here for simplicity).
          { name: 'analyticsEvents', target: 'analyticsEvents', kind: 'many', fk: 'userId' },
        ],
      },
    });
    const matches = db.relations.users.filter((r) => r.name === 'analyticsEvents');
    assert.equal(matches.length, 1, 'override should not duplicate');
  });
});
