import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { statePage, wrongLinkPage, type PageState } from './page.ts';

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

/** The browser tab a login leaves open, which `openTunnel()` keeps up to date. */
export interface LoginPage {
  show(state: PageState): void;
  /** Stop answering: an open tab then says the terminal is gone. */
  close(): void;
}

/** How long the page's server outlives a login whose tunnel never opens or fails. */
const PAGE_IDLE_MS = 10 * 60_000;
/** After a last state, how long a polling tab has to fetch it. */
const LAST_STATE_MS = 10_000;

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
  return (await loginInBrowser(options)).token;
}

/**
 * `login()`, with the tab it leaves: `/callback` redirects to `/done`, so the token doesn't stay
 * in the address bar, and `/done` shows `state` (`done` by default). The server keeps answering
 * `/done` and `/status` for `page`, without holding the process up.
 */
export async function loginInBrowser(options: LoginOptions & { state?: PageState } = {}): Promise<{ token: string; page: LoginPage }> {
  const endpoint = options.endpoint ?? cloudEndpoint();
  const log = options.log ?? console.log;
  const state = randomBytes(16).toString('hex');

  let resolve!: (token: string) => void;
  let reject!: (e: Error) => void;
  const got = new Promise<string>((res, rej) => { resolve = res; reject = rej; });

  let shown: PageState | undefined; // set by the callback
  let closeTimer: NodeJS.Timeout | undefined;
  const close = () => {
    clearTimeout(closeTimer);
    server.close();
    server.closeAllConnections();
  };
  const last = () => shown?.state === 'done' || shown?.state === 'failed';
  // a live page lasts as long as its tunnel, which closes it
  const schedule = () => {
    clearTimeout(closeTimer);
    if (shown?.state === 'live') { return; }
    closeTimer = setTimeout(close, last() ? LAST_STATE_MS : PAGE_IDLE_MS).unref();
  };

  let host = '';
  const server = http.createServer((req, res) => {
    // only our own 127.0.0.1 link: a DNS-rebound page can't read the tunnel's URL off /status
    if (req.headers.host !== host) {
      res.writeHead(400).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/callback') {
      const token = url.searchParams.get('token');
      if (url.searchParams.get('state') !== state || (!shown && !token)) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(wrongLinkPage());
        return;
      }
      if (!shown) {
        shown = options.state ?? { state: 'done' };
        resolve(token!);
      }
      res.writeHead(303, { Location: '/done' }).end();

    } else if (url.pathname === '/done' && shown) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        .end(statePage(shown), () => { if (last()) { close(); } });

    } else if (url.pathname === '/status' && shown) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ state: shown.state }));

    } else {
      res.writeHead(404).end();
    }
  });

  // a polling tab's keep-alive socket mustn't hold the process; until the callback, the timer does
  server.on('connection', (socket) => socket.unref());
  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => res());
  });
  const port = (server.address() as { port: number }).port;
  host = `127.0.0.1:${port}`;
  const timer = setTimeout(() => reject(new Error('the login timed out')), options.timeoutMs ?? 5 * 60_000);

  let token: string;
  try {
    const url = `${endpoint}/tunnel/authorize?port=${port}&state=${state}`;
    log(`Log in to Colyseus Cloud to share: ${url}`);
    openBrowser(url);

    token = await got;
  } catch (e) {
    close();
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const store = readStore();
  store[endpoint] = { token };
  writeStore(store);

  server.unref();
  schedule();
  return {
    token,
    page: {
      show(next) {
        shown = next;
        schedule();
      },
      close,
    },
  };
}

function openBrowser(url: string) {
  if (process.env.BROWSER === 'none') { return; }
  const [command, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
