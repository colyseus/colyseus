import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

/** Colyseus Cloud: `CLOUD_ENDPOINT`, as for `@colyseus/cloud`, else production. */
export function cloudEndpoint(): string {
  return (process.env.CLOUD_ENDPOINT || 'https://cloud-prod.colyseus.io').replace(/\/+$/, '');
}

/** Tunnel tokens `login()` got, by Cloud endpoint. */
function storePath(): string {
  return path.join(os.homedir(), '.colyseus', 'tunnel.json');
}

function readStore(): Record<string, { token: string }> {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, { token: string }>) {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600); // `mode` only applies to a new file
}

export function storedToken(endpoint = cloudEndpoint()): string | undefined {
  return readStore()[endpoint]?.token;
}

export function forgetToken(endpoint = cloudEndpoint()) {
  const store = readStore();
  if (!store[endpoint]) { return; }
  delete store[endpoint];
  writeStore(store);
}

export interface LoginOptions {
  endpoint?: string;
  /** Where the prompt goes (default: console.log). */
  log?: (line: string) => void;
  /** Give up after this long (default: 5 minutes). */
  timeoutMs?: number;
}

const DONE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Sharing is set up - Colyseus Cloud</title></head>
<body style="display:flex;align-items:center;justify-content:center;font-family:Arial;font-size:1.2em">
<p>✓ You can close this tab and go back to your terminal.</p>
</body></html>`;

/**
 * Get a tunnel token from Colyseus Cloud through the browser, and store it
 * (`~/.colyseus/tunnel.json`, readable by this user alone).
 *
 * The browser opens `<endpoint>/tunnel/authorize?port=<port>&state=<state>`,
 * where the user logs in and picks the team the tunnel counts against.
 * Cloud then sends it to `http://127.0.0.1:<port>/callback?state=<state>&token=<id|secret>`,
 * which this answers. `state` is random per login, so a page that guesses
 * the port can't hand us a token of its own. `BROWSER=none` only prints the
 * URL.
 */
export async function login(options: LoginOptions = {}): Promise<string> {
  const endpoint = options.endpoint ?? cloudEndpoint();
  const log = options.log ?? console.log;
  const state = randomBytes(16).toString('hex');

  let resolve!: (token: string) => void;
  let reject!: (e: Error) => void;
  const got = new Promise<string>((res, rej) => { resolve = res; reject = rej; });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const token = url.searchParams.get('token');
    if (url.searchParams.get('state') !== state || !token) {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('This login link is not the one your terminal is waiting for.\n');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(DONE_HTML, () => resolve(token));
  });

  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => res());
  });
  const timer = setTimeout(() => reject(new Error('the login timed out')), options.timeoutMs ?? 5 * 60_000);

  try {
    const port = (server.address() as { port: number }).port;
    const url = `${endpoint}/tunnel/authorize?port=${port}&state=${state}`;
    log(`Log in to Colyseus Cloud to share: ${url}`);
    openBrowser(url);

    const token = await got;
    const store = readStore();
    store[endpoint] = { token };
    writeStore(store);
    return token;
  } finally {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  }
}

function openBrowser(url: string) {
  if (process.env.BROWSER === 'none') { return; }
  const [command, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
