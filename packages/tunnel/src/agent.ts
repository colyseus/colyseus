import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import readline from 'node:readline';

const BINARY = process.platform === 'win32' ? 'routez-tunnel-agent.exe' : 'routez-tunnel-agent';

/**
 * The tunnel agent's executable: `COLYSEUS_TUNNEL_AGENT`, else the binary in
 * this platform's package (`@colyseus/tunnel-darwin-arm64`, ...), else
 * `routez-tunnel-agent` on the PATH. A `.js`/`.mjs` one runs under Node.
 */
export function agentPath(): string {
  if (process.env.COLYSEUS_TUNNEL_AGENT) { return process.env.COLYSEUS_TUNNEL_AGENT; }
  try {
    const pkg = createRequire(import.meta.url).resolve(`@colyseus/tunnel-${process.platform}-${process.arch}/package.json`);
    return path.join(path.dirname(pkg), 'bin', BINARY);
  } catch {
    return BINARY;
  }
}

/** How a tunnel agent ended. */
export interface AgentExit {
  code: number | null;
  /** The edge turned the credentials down (401). */
  unauthorized: boolean;
  /** Its last warning or error, or why it never started. */
  reason?: string;
}

export interface AgentProcess {
  /** Each URL the edge serves the tunnel at: once, unless the name changes. */
  onUrl(listener: (url: string) => void): void;
  /** Settles when the process is gone. */
  exited: Promise<AgentExit>;
  /** Ask it to close the tunnel and exit (its stdin closes); killed if it takes over 5 s. */
  stop(): Promise<AgentExit>;
}

/**
 * Run the tunnel agent for `local` against `edge`, with `auth` as its
 * credentials (`user:password`). They go in its environment, where other
 * users' `ps` can't see them.
 */
export function startAgent(edge: string, local: string, auth: string, name: string | undefined, log: (line: string) => void): AgentProcess {
  const bin = agentPath();
  const args = [...(name ? ['-n', name] : []), edge, local];
  const script = /\.m?js$/.test(bin);
  // stdin a pipe: closing it ends the tunnel, the one way that reaches a Windows process too.
  // It closes when this process exits, however it exits, so the agent never outlives us with
  // the name held. On Windows libuv otherwise puts the agent in a job that dies with us, before
  // it can close the tunnel.
  const child = spawn(script ? process.execPath : bin, script ? [bin, ...args] : args, {
    env: { ...process.env, ROUTEZ_TUNNEL_AUTH: auth },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform === 'win32',
    windowsHide: true,
  });
  child.stdin!.on('error', () => {}); // EPIPE once it has exited

  const listeners: Array<(url: string) => void> = [];
  let unauthorized = false;
  let reason: string | undefined;

  readline.createInterface({ input: child.stdout! }).on('line', (line) => {
    const url = parseUrlLine(line);
    if (url) { listeners.forEach((l) => l(url)); }
  });
  readline.createInterface({ input: child.stderr! }).on('line', (line) => {
    const entry = parseLogLine(line);
    if (!entry || entry.level === 'info' || entry.level === 'debug') { return; }
    // its hint names its own flags: the caller says what a turned-down token means
    if (entry.message.includes('refused the tunnel: 401')) {
      unauthorized = true;
      return;
    }
    reason = entry.message;
    log(entry.message);
  });

  const exited = new Promise<AgentExit>((resolve) => {
    child.once('error', (e: NodeJS.ErrnoException) => {
      resolve({
        code: null,
        unauthorized: false,
        reason: e.code === 'ENOENT'
          ? `no tunnel agent for ${process.platform}-${process.arch} (looked for ${agentPath()})`
          : e.message,
      });
    });
    child.once('exit', (code) => {
      resolve({ code, unauthorized, reason });
    });
  });

  return {
    onUrl: (listener) => { listeners.push(listener); },
    exited,
    stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.stdin!.end();
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        exited.finally(() => clearTimeout(timer));
      }
      return exited;
    },
  };
}

/** `https://name.play.colyseus.dev -> 127.0.0.1:5173`, the agent's one stdout line: the URL. */
export function parseUrlLine(line: string): string | undefined {
  return /^(https:\/\/\S+) -> /.exec(line)?.[1];
}

/** `2026/11/05 18:59:58 [warning] tunnel: message`, the agent's stderr. */
export function parseLogLine(line: string): { level: string, message: string } | undefined {
  const m = /^\S+ \S+ \[(\w+)\] (?:[\w.]+: )?(.*)$/.exec(line);
  return m ? { level: m[1], message: m[2] } : undefined;
}
