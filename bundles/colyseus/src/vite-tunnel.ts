/**
 * The colyseus() Vite plugin's `tunnel` option: `s` + enter shares the dev
 * server through Colyseus Cloud. `@colyseus/tunnel` does the work; it is
 * loaded only when installed, and the shortcut says how to get it when not.
 *
 * Requests through a tunnel (Host under the edge's domain) get what
 * `vite build` would ship, and a 404 for any other file under the root or
 * through `/@fs/`. Vite's dev server answers any path naming a file in the
 * project: through a tunnel that would include the game's data, keys and
 * scripts. What the page gets:
 *
 * - `public/`, the root's `.html` pages and the build's inputs;
 * - what the page loads: each module another one imports (a file fetched
 *   directly, as Vite records any it transforms, isn't one), the files an
 *   `.html` page sent through the tunnel names (its entry script can beat
 *   Vite's own record of it), and the assets and code in or below a folder
 *   holding one of those modules, reached by URL rather than `import`
 *   (`new URL(..., import.meta.url)`, CSS `url()`, workers). Data never
 *   counts that way: a `.json`, `.txt`, `.db` or extensionless file must be
 *   imported, or sit in `public/`;
 * - dependencies: `node_modules` and Vite's cache.
 *
 * The root and the folders above it count for their own files only, never
 * their subfolders: Vite's vanilla template keeps main.js at the root. A
 * URL is checked as the file it names and as the file Vite's resolver turns
 * it into (`/src/server/index` loads index.ts). Paths naming no file pass:
 * the page fallback, Vite's own URLs, the game server's routes.
 *
 * Whatever the page loads, they never get the server entry's folder (code
 * there stays out of reach as long as the client only `import type`s it; a
 * server entry at the root protects only itself), the project's
 * configuration (`CONFIG_FILE`: package.json, lockfiles, tsconfig.json,
 * vite.config.ts, in the root or a folder above it) unless the page imports
 * it, or `/__open-in-editor`, which opens files in the developer's editor.
 * Secrets anywhere (`.env`, `.git/`, keys) the tunnel edge refuses for every
 * tunnel, Vite or not.
 *
 * A file kept out is logged once. A page fetching data at runtime needs it in
 * `public/`, as its build would.
 */
import fs from 'node:fs';
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
      if (t) {
        const c = server.config;
        const build: any = c.build;
        const input = (build.rolldownOptions ?? build.rollupOptions)?.input;
        const client = server.environments?.client;
        server.middlewares.use(guard({
          root: c.root,
          serverEntry,
          hostSuffix: t.tunnelHostSuffix(),
          base: c.base,
          publicDir: c.publicDir,
          cacheDir: c.cacheDir,
          inputs: typeof input === 'string' ? [input] : Array.isArray(input) ? input : Object.values(input ?? {}),
          pageFiles: () => (client?.moduleGraph ?? server.moduleGraph).fileToModulesMap,
          isAsset: (file) => c.assetsInclude(file),
          resolve: async (url) => (await (client?.pluginContainer ?? server.pluginContainer).resolveId(url))?.id,
          refused: (p) => c.logger.warn(`  Kept ${p} out of the tunnel: the page doesn't load it. Files it fetches at runtime go in public/.`),
        }));
      }
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

/** Code a page reaches by URL: workers, styles, wasm. */
const CODE_FILE = /\.(m?[jt]sx?|c[jt]s|css|s[ac]ss|less|styl(us)?|p?css|wasm|vue|svelte|astro)$/i;
/** Assets past Vite's own list (`assetsInclude`), as games load them. */
const GAME_ASSET = /\.(png|jpe?g|gif|svg|ico|webp|avif|mp[34]|webm|ogg|wav|flac|aac|opus|m4a|woff2?|eot|ttf|otf|glb|gltf|bin|hdr|exr|ktx2|basis|drc|fbx|obj|mtl|usdz)$/i;

/** Project and tool configuration a page never loads, by file name. */
const CONFIG_FILE = /^(package(-lock)?\.json|npm-shrinkwrap\.json|pnpm-(lock|workspace)\.yaml|yarn\.lock|bun\.lockb?|deno\.jsonc?|[jt]sconfig(\..*)?\.json|.*\.config\.[cm]?[jt]s|dockerfile.*|docker-compose.*\.ya?ml|compose\.ya?ml)$/i;

export interface GuardOptions {
  root: string;
  serverEntry: string;
  /** The tunnel edge's domain, as `.play.colyseus.dev`. */
  hostSuffix: string;
  /** Vite's `base`: URLs under it name files from the root. */
  base?: string;
  /** Vite's `publicDir`; empty for none. */
  publicDir?: string;
  /** Vite's `cacheDir`: the pre-bundled dependencies. */
  cacheDir?: string;
  /** The build's inputs, served like the root's pages. */
  inputs?: string[];
  /** The client's module graph, by file: Vite's `fileToModulesMap`. */
  pageFiles?: () => ReadonlyMap<string, Iterable<{ importers: { size: number } }>> | undefined;
  /** Vite's `assetsInclude`: the files the folder rule may serve, with code and game formats. */
  isAsset?: (file: string) => boolean;
  /** The file Vite's resolver loads for a URL, as Vite's own transform asks it. */
  resolve?: (url: string) => Promise<string | undefined>;
  /** Told once about each path it keeps out. */
  refused?: (path: string) => void;
}

/** A middleware keeping tunnelled requests to what the page loads (this module's doc). */
export function guard(o: GuardOptions) {
  // Windows paths compare without case: C:\App and c:\app are one folder
  const key = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
  // the graph holds real paths: a symlinked root or file must compare as one
  const real = (file: string) => { try { return key(fs.realpathSync.native(file)); } catch { return key(file); } };
  const isFile = (file: string) => { try { return fs.statSync(file).isFile(); } catch { return false; } };
  const within = (file: string, dir: string) => file === dir || file.startsWith(dir + path.sep);

  const root = real(o.root);
  const entryFile = path.isAbsolute(o.serverEntry) && o.serverEntry.startsWith(o.root) ? o.serverEntry : path.join(o.root, o.serverEntry);
  const entry = real(entryFile);
  const entryDir = path.dirname(entry);
  const inside = (file: string) => file === entry || (entryDir !== root && within(file, entryDir));
  // the root and every folder above it
  const above = new Set<string>();
  for (let d = root; !above.has(d); d = path.dirname(d)) { above.add(d); }
  const config = (file: string) => above.has(path.dirname(file)) && CONFIG_FILE.test(path.basename(file));

  const base = o.base?.startsWith('/') && o.base.length > 1 ? o.base : undefined;
  const pub = o.publicDir ? real(o.publicDir) : undefined;
  const cache = o.cacheDir ? real(o.cacheDir) : undefined;
  const inputs = new Set((o.inputs ?? []).map((i) => real(path.resolve(o.root, i))));
  const named = new Set<string>();

  // the page's modules and their folders, rebuilt as the graph grows and on a miss
  let files = new Set<string>(), dirs = new Set<string>(), size = -1;
  const graph = (fresh: boolean) => {
    const map = o.pageFiles?.();
    if (!map || (!fresh && map.size === size)) { return; }
    size = map.size;
    files = new Set();
    dirs = new Set();
    for (const [id, modules] of map) {
      if (!path.isAbsolute(id) || ![...modules].some((m) => m.importers.size > 0)) { continue; } // virtual, or fetched directly
      const f = key(id);
      files.add(f);
      if (!/\.html$/i.test(f)) { dirs.add(path.dirname(f)); } // a page's inline scripts are its, not its folder's
    }
  };

  const loadable = (f: string) => {
    if ((pub && within(f, pub)) || inputs.has(f) || (path.dirname(f) === root && /\.html$/i.test(f))) { return true; }
    if ((within(f, root) ? path.relative(root, f) : f).split(path.sep).includes('node_modules')) { return true; }
    if ((cache && within(f, cache)) || named.has(f) || files.has(f)) { return true; }
    if (!byFolder(f)) { return false; }
    for (let d = path.dirname(f); ; d = path.dirname(d)) {
      if (above.has(d)) { return d === path.dirname(f) && dirs.has(d); }
      if (dirs.has(d)) { return true; }
      if (path.dirname(d) === d) { return false; }
    }
  };
  // reached by URL beside the page's modules: assets and code, never data
  const byFolder = (f: string) => !/\.txt$/i.test(f) && (CODE_FILE.test(f) || GAME_ASSET.test(f) || !!o.isAsset?.(f));
  const allowed = (f: string) => !inside(f) && (!config(f) || files.has(f)) && loadable(f);

  // what an .html page names is the page's, before Vite has looked at it
  const name = (html: string) => {
    let text: string;
    try { text = fs.readFileSync(html, 'utf8'); } catch { return; }
    for (const [, ref] of text.matchAll(/\s(?:src|href)\s*=\s*["']?([^"'\s>#?]+)/gi)) {
      if (/^([a-z][a-z\d+.-]*:|\/\/)/i.test(ref)) { continue; } // another origin, data:
      named.add(real(ref.startsWith('/') ? path.join(o.root, ref) : path.join(path.dirname(html), ref)));
    }
  };

  const told = new Set<string>();
  const refuse = (res: any, p: string) => {
    if (!told.has(p) && told.size < 100) {
      told.add(p);
      o.refused?.(p);
    }
    res.statusCode = 404;
    res.end();
  };

  async function check(req: any): Promise<string | undefined> {
    let p = String(req.url ?? '/').split('?')[0];
    try { p = decodeURIComponent(p); } catch { /* left encoded: Vite won't find it either */ }
    p = path.posix.normalize(p);
    if (base && p.startsWith(base)) { p = p.slice(base.length - 1); }
    if (p === '/__open-in-editor' || p.startsWith('/__open-in-editor/')) { return p; }

    // `/@fs/<abs>` and `/@id/<id>` name files outside the root's URL space;
    // on Windows the absolute path starts with its drive: /@fs/C:/app/...
    const abs = /^\/@(fs|id)\//.test(p);
    let file = abs ? p.replace(/^\/@(fs|id)\//, '/') : p;
    if (abs && /^\/[A-Za-z]:[\\/]/.test(file)) { file = file.slice(1); }
    const target = abs ? path.resolve(file) : path.join(o.root, file);

    // the file the URL names, and the one Vite's resolver turns it into
    const found = new Set<string>();
    if (isFile(target)) { found.add(real(target)); }
    const id = p.startsWith('/@id/') ? p.slice('/@id/'.length).replace('__x00__', '\0') : p;
    const resolved = (await o.resolve?.(id).catch(() => undefined))?.split('?')[0];
    if (resolved && path.isAbsolute(resolved) && isFile(resolved)) { found.add(real(resolved)); }

    graph(false);
    // the server's folder and the configuration, as named, file or not
    const t = real(target);
    if (inside(t) || (config(t) && !files.has(t))) { return p; }

    if (found.size === 0) {
      // the page fallback, or a folder's index.html
      if (String(req.headers.accept ?? '').includes('text/html')) {
        const index = path.join(target, 'index.html');
        name(isFile(index) ? index : path.join(o.root, 'index.html'));
      }
      return undefined;
    }
    if (![...found].every(allowed)) {
      graph(true);
      if (![...found].every(allowed)) { return p; }
    }
    for (const f of found) { if (/\.html$/i.test(f)) { name(f); } }
    return undefined;
  }

  return (req: any, res: any, next: () => void) => {
    const host = String(req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (!host.endsWith(o.hostSuffix)) { return next(); }
    check(req).then((kept) => kept ? refuse(res, kept) : next(), () => refuse(res, String(req.url)));
  };
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number, reset: number, text: string) => color ? `\x1b[${code}m${text}\x1b[${reset}m` : text;

function printShared(logger: Logger, t: TunnelModule, url: string) {
  const qr = t.qrCode(url).split('\n').map((line) => '  ' + line).join('\n');
  logger.info(`  ${paint(32, 39, '➜')}  ${paint(1, 22, 'Shared')}:  ${paint(36, 39, url + '/')}\n\n${qr}\n`);
}
