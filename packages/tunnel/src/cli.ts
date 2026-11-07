/**
 * `colyseus-tunnel [-n name] <port | host:port>`: share a local server
 * until Ctrl-C. `colyseus-tunnel logout` forgets the stored login.
 */
import { logout, openTunnel, qrCode } from './index.ts';

const USAGE = `usage: colyseus-tunnel [-n name] <port | host:port>
       colyseus-tunnel logout
  -n name  ask for https://<name>.play.colyseus.dev (default: a random name)

Logs in to Colyseus Cloud through the browser the first time, or takes
COLYSEUS_CLOUD_TOKEN.
`;

async function main(argv: string[]) {
  let name: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-h' || argv[i] === '--help') { return usage(0); }
    if (argv[i] === '-n' || argv[i] === '--name') {
      name = argv[++i];
    } else {
      rest.push(argv[i]);
    }
  }
  if (rest[0] === 'logout' && rest.length === 1) {
    logout();
    console.log('Logged out of Colyseus Cloud tunnels.');
    return;
  }
  if (rest.length !== 1 || (argv.includes('-n') && !name)) { return usage(2); }

  const tunnel = await openTunnel({ local: rest[0], name });
  console.log(`\n  ${tunnel.url} -> ${rest[0]}\n`);
  console.log(indent(qrCode(tunnel.url)));
  console.log('  Ctrl-C to stop sharing.');

  // Ctrl-C reaches the tunnel agent too, which closes the tunnel and exits.
  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
    tunnel.close().then(() => process.exit(0));
  });
  const { revoked } = await tunnel.closed;
  if (stopping) { return; }
  const why = revoked
    ? 'Stopped sharing: your Colyseus Cloud login was revoked. Run colyseus-tunnel again to log in.\n'
    : 'Stopped sharing: the tunnel agent gave up.\n';
  // exit once it's written: a pipe's writes are asynchronous on macOS
  process.stderr.write(why, () => process.exit(1));
}

function usage(code: number) {
  (code === 0 ? process.stdout : process.stderr).write(USAGE);
  process.exit(code);
}

function indent(text: string) {
  return text.split('\n').map((line) => '  ' + line).join('\n');
}

main(process.argv.slice(2)).catch((e) => {
  console.error(`colyseus-tunnel: ${e.message}`);
  process.exit(1);
});
