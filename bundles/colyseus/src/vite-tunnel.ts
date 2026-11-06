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

      // Vite's CLI binds its shortcuts once it listens; ours go along.
      const bind = server.bindCLIShortcuts.bind(server);
      server.bindCLIShortcuts = (options) => bind({
        ...options,
        customShortcuts: [
          ...(options?.customShortcuts ?? []),
          { key: 's', description: 'share on a public URL', action: share },
        ],
      });

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

/** A middleware turning tunnelled requests for the server entry's folder away. */
export function guard(root: string, serverEntry: string, hostSuffix: string) {
  const entry = path.isAbsolute(serverEntry) && serverEntry.startsWith(root) ? serverEntry : path.join(root, serverEntry);
  const dir = path.dirname(entry);
  const inside = (file: string) => file === entry || (dir !== root && (file === dir || file.startsWith(dir + path.sep)));

  return (req: any, res: any, next: () => void) => {
    const host = String(req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (!host.endsWith(hostSuffix)) { return next(); }
    let p = String(req.url ?? '/').split('?')[0];
    try { p = decodeURIComponent(p); } catch { /* left encoded: Vite won't find it either */ }
    // `/@fs/<abs>` and `/@id/<id>` name files outside the root's URL space.
    p = p.replace(/^\/@(fs|id)\//, '/');
    if (inside(path.join(root, p)) || inside(path.resolve(p))) {
      res.statusCode = 404;
      return res.end();
    }
    next();
  };
}

function printShared(logger: Logger, t: TunnelModule, url: string) {
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  const paint = (code: number, reset: number, text: string) => color ? `\x1b[${code}m${text}\x1b[${reset}m` : text;
  const qr = t.qrCode(url).split('\n').map((line) => '  ' + line).join('\n');
  logger.info(`  ${paint(32, 39, '➜')}  ${paint(1, 22, 'Shared')}:  ${paint(36, 39, url + '/')}\n\n${qr}\n`);
}
