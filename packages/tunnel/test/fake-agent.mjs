#!/usr/bin/env node
// Stands in for routez-tunnel-agent: `-n name` gets that name, credentials
// `bad:token` are turned down as the edge would, `taken` never gets a URL.
const args = process.argv.slice(2);
const name = args[0] === '-n' ? args[1] : 'r4nd0m00';
const local = args[args.length - 1];
const log = (level, message) => console.error(`2026/11/05 18:59:58 [${level}] tunnel: ${message}`);

import fs from 'node:fs';

// FAKE_EDGE_KNOWS: turned down until that file exists, as before the edge's next pull
const unknown = process.env.FAKE_EDGE_KNOWS && !fs.existsSync(process.env.FAKE_EDGE_KNOWS);
if (process.env.ROUTEZ_TUNNEL_AUTH === 'bad:token' || unknown) {
  log('error', 'the edge refused the tunnel: 401 wrong or missing user and password (-u, ROUTEZ_TUNNEL_AUTH)');
  process.exit(1);
}
if (name === 'taken') {
  log('error', 'the edge refused the tunnel: 409 the name is taken');
} else {
  log('info', 'not shown');
  console.log(`https://${name}.play.test -> ${local}`);
  // FAKE_REVOKE_MS: the edge turns the token down that long after (revoked in Cloud)
  if (process.env.FAKE_REVOKE_MS) {
    setTimeout(() => {
      log('error', 'the edge refused the tunnel: 401 wrong or missing user and password (-u, ROUTEZ_TUNNEL_AUTH)');
      process.exit(1);
    }, Number(process.env.FAKE_REVOKE_MS));
  }
}
// as the real one: its stdin closing ends the tunnel
process.stdin.on('end', () => process.exit(0)).resume();
process.on('SIGINT', () => process.exit(0));
setInterval(() => {}, 1000);
