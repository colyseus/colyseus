import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { credentials, login, openTunnel, storedToken, tunnelHostSuffix, TunnelError } from '../src/index.ts';
import { parseLogLine, parseUrlLine } from '../src/agent.ts';

const FAKE_AGENT = path.join(import.meta.dirname, 'fake-agent.mjs');

/** The callback a login prompt names, as the browser would follow it from Cloud. */
function callbackOf(prompt: string, token: string, state?: string) {
  const url = new URL(prompt.slice(prompt.indexOf('http')));
  const port = url.searchParams.get('port');
  return `http://127.0.0.1:${port}/callback?state=${state ?? url.searchParams.get('state')}&token=${encodeURIComponent(token)}`;
}

describe('@colyseus/tunnel', () => {
  // Key by key: a replaced `process.env` is a plain object, which no longer
  // reaches `os.homedir()`.
  const KEYS = ['HOME', 'CLOUD_ENDPOINT', 'COLYSEUS_TUNNEL_AGENT', 'BROWSER', 'COLYSEUS_CLOUD_TOKEN', 'FAKE_EDGE_KNOWS', 'FAKE_REVOKE_MS'];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'tunnel-test-'));
    process.env.HOME = home;
    process.env.CLOUD_ENDPOINT = 'http://cloud.test';
    process.env.COLYSEUS_TUNNEL_AGENT = FAKE_AGENT;
    process.env.BROWSER = 'none';
    delete process.env.COLYSEUS_CLOUD_TOKEN;
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) { delete process.env[k]; } else { process.env[k] = saved[k]; }
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('reads the tunnel agent\'s URL and log lines', () => {
    assert.strictEqual(parseUrlLine('https://game.play.colyseus.dev -> [::1]:5173'), 'https://game.play.colyseus.dev');
    assert.strictEqual(parseUrlLine('something else'), undefined);
    assert.deepStrictEqual(parseLogLine('2026/11/05 18:59:58 [warning] tunnel: session to the edge lost; reconnecting'),
      { level: 'warning', message: 'session to the edge lost; reconnecting' });
  });

  it('turns a Cloud token into the edge\'s credentials', () => {
    assert.strictEqual(credentials('42|s3cr|et'), '42:s3cr|et');
    assert.strictEqual(credentials('user:pw'), 'user:pw');
    assert.strictEqual(tunnelHostSuffix('https://play.colyseus.dev/.tunnel'), '.play.colyseus.dev');
  });

  it('opens a tunnel and closes it', async () => {
    const tunnel = await openTunnel({ local: 5173, token: '1|abc', name: 'game' });
    assert.strictEqual(tunnel.url, 'https://game.play.test');
    assert.strictEqual(tunnel.name, 'game');
    await tunnel.close();
    assert.deepStrictEqual(await tunnel.closed, { revoked: false });
  });

  it('says so when the token is revoked mid-run, and forgets it', async () => {
    fs.mkdirSync(path.join(home, '.colyseus'));
    fs.writeFileSync(path.join(home, '.colyseus', 'tunnel.json'), JSON.stringify({ 'http://cloud.test': { token: '5|stored' } }));
    process.env.FAKE_REVOKE_MS = '200';

    const lines: string[] = [];
    const tunnel = await openTunnel({ local: 2567, log: (l) => lines.push(l) });
    assert.deepStrictEqual(await tunnel.closed, { revoked: true });
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(storedToken(), undefined);
    assert.deepStrictEqual(lines, []); // the agent's own hint isn't for this tool's users
  });

  it('gives up on a name it never gets, saying why', async () => {
    const lines: string[] = [];
    await assert.rejects(
      openTunnel({ local: 5173, token: '1|abc', name: 'taken', timeoutMs: 500, log: (l) => lines.push(l) }),
      (e: TunnelError) => e.code === 'timeout',
    );
    assert.deepStrictEqual(lines, ['the edge refused the tunnel: 409 the name is taken']);
  });

  it('turned down with a token it was given, fails without logging in', async () => {
    await assert.rejects(openTunnel({ local: 5173, token: 'bad|token', log: () => {} }), (e: TunnelError) => e.code === 'unauthorized');
  });

  it('logs in through the browser and keeps the token for this user alone', async () => {
    let prompt = '';
    const pending = login({ log: (l) => { prompt = l; } });
    while (!prompt) { await new Promise((r) => setTimeout(r, 10)); }

    assert.strictEqual((await fetch(callbackOf(prompt, '7|x', 'forged'))).status, 400);
    assert.strictEqual((await fetch(callbackOf(prompt, '7|good'))).status, 200);
    assert.strictEqual(await pending, '7|good');

    assert.strictEqual(storedToken(), '7|good');
    assert.strictEqual(fs.statSync(path.join(home, '.colyseus', 'tunnel.json')).mode & 0o777, 0o600);
  });

  it('waits for the edge to take a new login instead of logging in again', async () => {
    const knows = path.join(home, 'edge-knows');
    process.env.FAKE_EDGE_KNOWS = knows;
    const lines: string[] = [];
    let logins = 0;
    const tunnel = await openTunnel({
      local: 2567,
      log: (l) => {
        lines.push(l);
        if (!l.startsWith('Log in')) { return; }
        logins++;
        fetch(callbackOf(l, '9|new'));
        setTimeout(() => fs.writeFileSync(knows, ''), 1000); // the edge's next pull
      },
    });
    delete process.env.FAKE_EDGE_KNOWS;
    assert.strictEqual(tunnel.url, 'https://r4nd0m00.play.test');
    assert.strictEqual(logins, 1);
    assert.deepStrictEqual(lines.filter((l) => !l.startsWith('Log in')), ['Waiting for the tunnel edge to take your new login...']);
    await tunnel.close();
  });

  it('logs in again when the stored token is turned down', async () => {
    fs.mkdirSync(path.join(home, '.colyseus'));
    fs.writeFileSync(path.join(home, '.colyseus', 'tunnel.json'), JSON.stringify({ 'http://cloud.test': { token: 'bad|token' } }));

    const lines: string[] = [];
    const opening = openTunnel({
      local: 2567,
      log: (l) => {
        lines.push(l);
        if (l.startsWith('Log in')) { fetch(callbackOf(l, '8|fresh')); }
      },
    });
    const tunnel = await opening;
    assert.strictEqual(tunnel.url, 'https://r4nd0m00.play.test');
    assert.strictEqual(storedToken(), '8|fresh');
    assert.ok(lines.some((l) => l.includes('turned down')), lines.join('\n'));
    await tunnel.close();
  });
});
