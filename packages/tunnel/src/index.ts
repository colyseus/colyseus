/**
 * Share a server on this machine on a public URL, through Colyseus Cloud's
 * tunnel edge: `https://<name>.play.colyseus.dev` reaches your local
 * server, HTTP, WebSocket and WebTransport alike, with nothing listening on
 * the internet on your side.
 *
 * The work is done by the tunnel agent (`routez-tunnel-agent`), a native
 * binary from this platform's package, which dials out to the edge. This
 * package runs it, logs in to Cloud for its token, and reads back its URL.
 */
/// <reference types="node" />
// TS 6 loads no @types by default, and no dependency here references node's.
import { renderUnicodeCompact } from 'uqr';
import { startAgent, type AgentProcess } from './agent.ts';
import { cloudEndpoint, forgetToken, loginInBrowser, storedToken, type LoginPage } from './login.ts';

export { login, forgetToken as logout, storedToken, cloudEndpoint } from './login.ts';
export { agentPath } from './agent.ts';

/** The edge's tunnel endpoint: `COLYSEUS_TUNNEL_EDGE`, else Colyseus Cloud's. */
export function edgeUrl(): string {
  return process.env.COLYSEUS_TUNNEL_EDGE || 'https://play.colyseus.dev/.tunnel';
}

/**
 * The host suffix players reach tunnels on (`.play.colyseus.dev`): tunnels
 * are served under the edge's own host name.
 */
export function tunnelHostSuffix(edge = edgeUrl()): string {
  return '.' + new URL(edge).hostname;
}

export interface TunnelOptions {
  /** The server to share: a port, or `host:port` (`[::1]:5173` for IPv6); the host is 127.0.0.1 unless named. */
  local: number | string;
  /**
   * Ask for `https://<name>.play.colyseus.dev`. Names are first come, first
   * served; a taken one is retried until `timeoutMs`. Without one, the edge
   * picks a random name, kept while the tunnel runs.
   */
  name?: string;
  /** A Cloud tunnel token, `id|secret`. Default: `COLYSEUS_CLOUD_TOKEN`, else the one `login()` stored. */
  token?: string;
  /** Without a token, or with a stored one the edge turns down: log in through the browser (default), or fail. */
  login?: boolean;
  /** The edge's tunnel endpoint (default: `edgeUrl()`). */
  edge?: string;
  /** The tunnel agent's warnings and errors, and the login prompt (default: console.warn). */
  log?: (line: string) => void;
  /** Fail when the edge hasn't given a URL by then (default: 30 s). */
  timeoutMs?: number;
}

export interface Tunnel {
  /** Where players reach it: `https://<name>.play.colyseus.dev`. */
  readonly url: string;
  /** The name it got: the one asked for, or the edge's pick. */
  readonly name: string;
  /** Close it; the name is free again at once. */
  close(): Promise<void>;
  /**
   * Settles when the tunnel is gone: closed, or its agent gave up. `revoked`: the edge turned
   * the token down mid-run (revoked in Cloud), and a stored login is forgotten with it.
   */
  readonly closed: Promise<{ revoked: boolean }>;
}

export type TunnelErrorCode = 'no-token' | 'unauthorized' | 'agent' | 'timeout';

export class TunnelError extends Error {
  code: TunnelErrorCode;
  constructor(code: TunnelErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Open a tunnel to `options.local`. It reconnects by itself when the
 * connection drops or the edge restarts, keeping its URL.
 */
export async function openTunnel(options: TunnelOptions): Promise<Tunnel> {
  const log = options.log ?? console.warn;
  const edge = options.edge ?? edgeUrl();
  const local = String(options.local);
  const endpoint = cloudEndpoint();
  const mayLogin = options.login ?? true;

  let token = options.token ?? process.env.COLYSEUS_CLOUD_TOKEN;
  // given (option or env), stored by an earlier login, or this call's own login
  let source: 'given' | 'stored' | 'fresh' = 'given';
  if (!token) {
    token = storedToken(endpoint);
    source = 'stored';
  }
  let loggedInAt = 0;
  let waiting = false;
  // the tab of this call's own login, which follows the tunnel
  let page: LoginPage | undefined;

  try {
    for (;;) {
      if (!token) {
        if (!mayLogin) { throw new TunnelError('no-token', 'no Colyseus Cloud token: set COLYSEUS_CLOUD_TOKEN, or log in'); }
        ({ token, page } = await loginInBrowser({ endpoint, log, state: { state: 'connecting', local } }));
        source = 'fresh';
        loggedInAt = Date.now();
      }
      try {
        // while the edge learns a new login, its refusals are expected
        const tunnel = await start(edge, local, credentials(token), options, waiting ? () => {} : log);
        if (source !== 'given') {
          tunnel.closed.then(({ revoked }) => { if (revoked) { forgetToken(endpoint); } });
        }
        if (page) {
          const tab = page;
          tab.show({ state: 'live', url: tunnel.url, local });
          tunnel.closed.then(() => tab.close());
        }
        return tunnel;
      } catch (e) {
        if (!(e instanceof TunnelError) || e.code !== 'unauthorized' || source === 'given') { throw e; }
        if (source === 'fresh') {
          // The edge pulls new logins from Cloud every few seconds: wait for it, not another login.
          if (Date.now() - loggedInAt > NEW_LOGIN_WAIT_MS) {
            throw new TunnelError('unauthorized', "the edge hasn't taken your new login yet; try again in a minute");
          }
          if (!waiting) { log('Waiting for the tunnel edge to take your new login...'); }
          waiting = true;
          await new Promise((resolve) => setTimeout(resolve, NEW_LOGIN_RETRY_MS));
          continue;
        }
        // A stored token can be revoked: log in again, once.
        forgetToken(endpoint);
        if (!mayLogin) { throw e; }
        log('Your Colyseus Cloud login was turned down; logging in again.');
        token = undefined;
      }
    }
  } catch (e) {
    page?.show({ state: 'failed', message: (e as Error).message });
    throw e;
  }
}

/** How long a new login may take to reach the edge, and how often to try meanwhile. */
const NEW_LOGIN_WAIT_MS = 90_000;
const NEW_LOGIN_RETRY_MS = 3_000;

/** A Cloud token (`id|secret`) as the edge's Basic credentials (`id:secret`). */
export function credentials(token: string): string {
  return token.includes('|') ? token.replace('|', ':') : token;
}

async function start(edge: string, local: string, auth: string, options: TunnelOptions, log: (line: string) => void): Promise<Tunnel> {
  const agent: AgentProcess = startAgent(edge, local, auth, options.name, log);
  let url: string | undefined;
  const first = new Promise<string>((resolve) => agent.onUrl((u) => {
    url = u;
    resolve(u);
  }));

  const ms = options.timeoutMs ?? 30_000;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TunnelError('timeout', `the edge gave no URL in ${Math.round(ms / 1000)} s`)), ms);
  });
  const failed = agent.exited.then((exit): never => {
    if (exit.unauthorized) { throw new TunnelError('unauthorized', 'the edge turned the Colyseus Cloud token down'); }
    throw new TunnelError('agent', `the tunnel agent stopped: ${exit.reason ?? `exit code ${exit.code}`}`);
  });
  failed.catch(() => {}); // only the race reads it; once open, `closed` reports the exit

  try {
    await Promise.race([first, timeout, failed]);
  } catch (e) {
    await agent.stop();
    throw e;
  } finally {
    clearTimeout(timer);
  }

  return {
    get url() { return url!; },
    get name() { return new URL(url!).hostname.split('.')[0]; },
    close: async () => { await agent.stop(); },
    closed: agent.exited.then((exit) => ({ revoked: exit.unauthorized })),
  };
}

/** `url` as a QR code of Unicode half blocks, for the terminal. */
export function qrCode(url: string): string {
  return renderUnicodeCompact(url, { border: 2 });
}
