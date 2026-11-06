/**
 * The colyseus() Vite plugin's `tunnel` option: `s` + enter shares the dev
 * server through Colyseus Cloud. `@colyseus/tunnel` does the work; it is
 * loaded only when installed, and the shortcut says how to get it when not.
 *
 * Requests through a tunnel (Host under the edge's domain) get 404 for
 * anything in the server entry's folder, `/@fs/` and `/@id/` paths
 * included: players load the page, not the server's source. Code there
 * stays out of reach as long as the client only `import type`s it, which
 * leaves no request behind. A server entry at the root protects only
 * itself.
 *
 * Nor do they get the project's configuration (`CONFIG_FILE`) from the
 * root or a folder above it, a monorepo's included: package.json, lockfiles,
 * tsconfig.json, vite.config.ts. The page never loads those, though it may
 * load scripts that sit at the root (Vite's vanilla template keeps main.js
 * there). Secrets anywhere (`.env`, `.git/`, keys) the tunnel edge refuses
 * for every tunnel, Vite or not.
 */
import path from 'node:path';
import type { Logger, Plugin, ViteDevServer } from 'vite';

type TunnelModule = typeof import('@colyseus/tunnel');
type Tunnel = Awaited<ReturnType<TunnelModule['openTunnel']>>;

export type TunnelSetting = boolean | { name?: string };

// The edge's pick, asked for again after a Vite restart so the URL holds.
let lastName: string | undefined;

export function tunnelPlugin(setting: TunnelSetting | undefined, serverEntry: string): Plugin[] {
  if (setting === false) { return []; }
  const asked = typeof setting === 'object' ? setting.name : undefined;

  let api: Promise<TunnelModule | undefined> | undefined;
  const load = () => api ??= import('@colyseus/tunnel').catch(() => undefined);

  let tunnel: Tunnel | undefined;
  let opening = false;

  async function share(server: ViteDevServer) {
    const logger = server.config.logger;
    const t = await load();
    if (!t) {
      return logger.warn('  To share, install @colyseus/tunnel (npm i -D @colyseus/tunnel), then restart Vite.');
    }
    if (tunnel) { return printShared(logger, t, tunnel.url); }
    if (opening) { return logger.info('  Still opening the tunnel...'); }
    const local = localAddress(server);
    if (!local) { return logger.warn("  Can't share: Vite isn't listening on a port."); }
    if (server.config.server.https) {
      return logger.warn("  Can't share an HTTPS dev server: the tunnel speaks plain HTTP to it.");
    }

    opening = true;
    try {
      const opened = await t.openTunnel({ local, name: asked ?? lastName, log: (line) => logger.warn(`  ${line}`) });
      tunnel = opened;
      lastName = opened.name;
      opened.closed.then(({ revoked }) => {
        if (tunnel !== opened) { return; }
        tunnel = undefined;
        logger.warn(revoked
          ? '  Stopped sharing: your Colyseus Cloud login was revoked. Press s + enter to log in again.'
          : '  Stopped sharing: press s + enter to share again.');
      });
      printShared(logger, t, opened.url);
    } catch (e: any) {
      logger.error(`  Couldn't share: ${e.message}`);
    } finally {
      opening = false;
    }
  }

  return [{
    name: 'colyseus:tunnel',
    apply: 'serve',
    async config(user) {
      const t = await load();
      if (!t || user.server?.allowedHosts === true) { return; }
      return { server: { allowedHosts: [t.tunnelHostSuffix()] } };
    },
    async configureServer(server) {
      const t = await load();
      if (t) { server.middlewares.use(guard(server.config.root, serverEntry, t.tunnelHostSuffix())); }
      const description = t ? `share on a public URL (*${t.tunnelHostSuffix()})` : 'share on a public URL';

      // Vite's CLI binds its shortcuts once it listens; ours go along, hinted under its "h + enter".
      const bind = server.bindCLIShortcuts.bind(server);
      server.bindCLIShortcuts = (options) => {
        bind({
          ...options,
          customShortcuts: [
            ...(options?.customShortcuts ?? []),
            { key: 's', description, action: share },
          ],
        });
        // Vite binds them only on a TTY outside CI
        if (options?.print && server.httpServer && process.stdin.isTTY && !process.env.CI) {
          server.config.logger.info(paint(2, 22, paint(32, 39, '  ➜') + '  press ') + paint(1, 22, 's + enter') + paint(2, 22, ` to ${description}`));
        }
      };

      server.httpServer?.once('close', () => {
        const t = tunnel;
        tunnel = undefined;
        t?.close();
      });
    },
  }];
}

/** Where the tunnel agent reaches Vite: the address it listens on, any-address as loopback. */
function localAddress(server: ViteDevServer): string | undefined {
  const a = server.httpServer?.address();
  if (!a || typeof a === 'string') { return undefined; }
  const host = a.address === '::' || a.address === '0.0.0.0' ? '127.0.0.1' : a.address;
  return host.includes(':') ? `[${host}]:${a.port}` : `${host}:${a.port}`;
}

/** Project and tool configuration a page never loads, by file name. */
const CONFIG_FILE = /^(package(-lock)?\.json|npm-shrinkwrap\.json|pnpm-(lock|workspace)\.yaml|yarn\.lock|bun\.lockb?|deno\.jsonc?|[jt]sconfig(\..*)?\.json|.*\.config\.[cm]?[jt]s|dockerfile.*|docker-compose.*\.ya?ml|compose\.ya?ml)$/i;

/** A middleware turning tunnelled requests for the server entry's folder and the project's configuration away. */
export function guard(root: string, serverEntry: string, hostSuffix: string) {
  // Windows paths compare without case: C:\App and c:\app are one folder
  const key = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
  const entry = key(path.isAbsolute(serverEntry) && serverEntry.startsWith(root) ? serverEntry : path.join(root, serverEntry));
  const dir = path.dirname(entry);
  const top = key(root);
  const inside = (file: string) => {
    const f = key(file);
    return f === entry || (dir !== top && (f === dir || f.startsWith(dir + path.sep)));
  };
  // the root and every folder above it
  const above = new Set<string>();
  for (let d = top; !above.has(d); d = path.dirname(d)) { above.add(d); }
  const config = (file: string) => {
    const f = key(file);
    return above.has(path.dirname(f)) && CONFIG_FILE.test(path.basename(f));
  };

  return (req: any, res: any, next: () => void) => {
    const host = String(req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (!host.endsWith(hostSuffix)) { return next(); }
    let p = String(req.url ?? '/').split('?')[0];
    try { p = decodeURIComponent(p); } catch { /* left encoded: Vite won't find it either */ }
    // `/@fs/<abs>` and `/@id/<id>` name files outside the root's URL space;
    // on Windows the absolute path starts with its drive: /@fs/C:/app/...
    p = p.replace(/^\/@(fs|id)\//, '/');
    if (/^\/[A-Za-z]:[\\/]/.test(p)) { p = p.slice(1); }
    const asUrl = path.join(root, p);
    const asFile = path.resolve(p);
    if (inside(asUrl) || inside(asFile) || config(asUrl) || config(asFile)) {
      res.statusCode = 404;
      return res.end();
    }
    next();
  };
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number, reset: number, text: string) => color ? `\x1b[${code}m${text}\x1b[${reset}m` : text;

function printShared(logger: Logger, t: TunnelModule, url: string) {
  const qr = t.qrCode(url).split('\n').map((line) => '  ' + line).join('\n');
  logger.info(`  ${paint(32, 39, '➜')}  ${paint(1, 22, 'Shared')}:  ${paint(36, 39, url + '/')}\n\n${qr}\n`);
}
