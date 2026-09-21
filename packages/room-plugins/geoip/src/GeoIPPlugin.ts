import { RoomPlugin, logger, type Client, type AuthContext } from '@colyseus/core';

import type { GeoIPData, GeoIPReader } from './types.ts';
import { MMDBReader } from './readers/MMDBReader.ts';
import { AutoDownloader, type AutoDownloaderOptions } from './readers/AutoDownloader.ts';
import { DBIPDownloader, type DBIPDownloaderOptions } from './readers/DBIPDownloader.ts';

/**
 * Constructor options. The three variants pick the database source:
 *
 *   { dbPath }                         — point at an MMDB file you manage
 *                                        (MaxMind via `geoipupdate`, or DB-IP).
 *   { accountId, licenseKey, cacheDir? } — auto-fetch GeoLite2-Country from
 *                                        MaxMind under your account.
 *   {}                                 — fetch DB-IP Lite Country from
 *                                        db-ip.com (CC BY 4.0, no account).
 *
 * Each room instance attaches the *same* loaded reader — readers are
 * cached in a module-level Map keyed by source so memory stays flat
 * across N rooms.
 */
export type GeoIPPluginOptions =
  | { dbPath: string }
  | (AutoDownloaderOptions & { refreshIntervalMs?: number })
  | (DBIPDownloaderOptions & { refreshIntervalMs?: number });

const HOUR = 60 * 60 * 1000;
const MAXMIND_REFRESH_MS = 7 * 24 * HOUR;   // GeoLite2 is rebuilt weekly
const DBIP_REFRESH_MS = 24 * HOUR;          // monthly snapshots — this only catches the rollover

const readerCache = new Map<string, Promise<GeoIPReader>>();
const refreshTimers = new Map<string, NodeJS.Timeout>();

/**
 * Drop-in plugin that resolves the client's country at auth time and
 * attaches it to `client.geoip` before `onJoin` runs.
 *
 *   plugins = definePlugins([
 *     new GeoIPPlugin({ dbPath: "./GeoLite2-Country.mmdb" }),
 *   ]);
 *
 *   async onJoin(client) {
 *     if (client.geoip?.isoCode === 'BR') { ... }
 *   }
 *
 * Lookup failures and unresolved IPs (loopback, private ranges) leave
 * `client.geoip` undefined; they never block the join.
 */
export class GeoIPPlugin extends RoomPlugin {
  readonly pluginName = 'geoip' as const;

  private opts: GeoIPPluginOptions;
  private cacheKey: string;
  private reader?: GeoIPReader;

  constructor(opts: GeoIPPluginOptions = {}) {
    super();
    this.opts = opts;
    this.cacheKey = computeCacheKey(opts);
  }

  protected async onCreate(): Promise<void> {
    let pending = readerCache.get(this.cacheKey);
    if (pending === undefined) {
      // Evict a failed load so the next room retries — a cached rejection
      // would outlive the database showing up. The identity check keeps a
      // newer entry (a refresh that landed meanwhile) in place.
      pending = loadReader(this.opts).catch((e) => {
        if (readerCache.get(this.cacheKey) === pending) { readerCache.delete(this.cacheKey); }
        throw e;
      });
      readerCache.set(this.cacheKey, pending);
      scheduleRefreshIfApplicable(this.cacheKey, this.opts);
    }
    this.reader = await pending;
  }

  protected onAuth(client: Client, _options: any, context: AuthContext): void {
    const ip = pickIp(context.ip);
    if (!ip) { return; }
    const data = this.lookup(ip);
    if (data) { (client as Client & { geoip?: GeoIPData }).geoip = data; }
  }

  /**
   * Look up an IP against the loaded database. Returns `undefined` for
   * unresolvable IPs (loopback, private ranges, not-in-DB, malformed)
   * and never throws — geo lookups should never block whatever flow
   * they're embedded in.
   *
   * Available on the room as `this.plugins.geoip.lookup(ip)`. Use it
   * when you need a geo result outside the auth phase — e.g. to
   * re-resolve on reconnect, drive an anti-fraud heuristic against a
   * known IP, or annotate analytics events with country.
   */
  lookup(ip: string): GeoIPData | undefined {
    if (!ip || !this.reader) { return undefined; }
    try {
      return this.reader.lookup(ip);
    } catch {
      return undefined;
    }
  }
}

/**
 * Resolve `AuthContext.ip` — which is `string | string[]` because some
 * transports surface the full x-forwarded-for chain — to a single IP.
 * We take the first entry on the assumption the proxy populated the
 * left-most position with the originating client.
 */
function pickIp(raw: string | string[] | undefined): string | undefined {
  if (!raw) { return undefined; }
  if (typeof raw === 'string') {
    const first = raw.split(',')[0].trim();
    return first || undefined;
  }
  return raw[0];
}

function computeCacheKey(opts: GeoIPPluginOptions): string {
  if ('dbPath' in opts && opts.dbPath) { return `path:${opts.dbPath}`; }
  if ('accountId' in opts && opts.accountId) {
    return `mm:${opts.accountId}:${opts.edition ?? 'GeoLite2-Country'}`;
  }
  return `dbip:${('cacheDir' in opts && opts.cacheDir) || ''}`;
}

function isPathMode(opts: GeoIPPluginOptions): opts is { dbPath: string } {
  return 'dbPath' in opts && typeof opts.dbPath === 'string' && opts.dbPath.length > 0;
}

function isAutoMode(opts: GeoIPPluginOptions): opts is AutoDownloaderOptions & { refreshIntervalMs?: number } {
  return 'accountId' in opts && typeof opts.accountId === 'string' && opts.accountId.length > 0;
}

async function loadReader(opts: GeoIPPluginOptions): Promise<GeoIPReader> {
  if (isPathMode(opts)) {
    return new MMDBReader(opts.dbPath);
  }
  if (isAutoMode(opts)) {
    const downloader = new AutoDownloader(opts);
    await downloader.fetch();
    return new MMDBReader(downloader.dbPath);
  }
  // Default mode — DB-IP Lite Country, fetched from db-ip.com on first
  // boot and reused from the on-disk cache afterwards.
  return new MMDBReader(await new DBIPDownloader(opts).fetch());
}

function scheduleRefreshIfApplicable(key: string, opts: GeoIPPluginOptions): void {
  if (isPathMode(opts)) { return; }   // the operator owns the file
  if (refreshTimers.has(key)) { return; }

  const auto = isAutoMode(opts);
  const interval = opts.refreshIntervalMs ?? (auto ? MAXMIND_REFRESH_MS : DBIP_REFRESH_MS);
  let loaded: string | undefined;

  const timer = setInterval(async () => {
    try {
      if (auto) {
        // MaxMind rewrites one filename, so a refresh always reopens.
        const downloader = new AutoDownloader(opts);
        await downloader.fetch(true);
        readerCache.set(key, Promise.resolve(new MMDBReader(downloader.dbPath)));

      } else {
        const dbPath = await new DBIPDownloader(opts).fetch();
        if (dbPath === loaded) { return; }   // same month — nothing to reopen
        loaded = dbPath;
        readerCache.set(key, Promise.resolve(new MMDBReader(dbPath)));
      }
    } catch (e: any) {
      // Keep serving the previous reader; next tick will retry — but say so,
      // or an expired license key silently serves a stale database for months.
      logger.warn(`@colyseus/geoip: database refresh failed, still serving the one loaded earlier — ${e.message}`);
    }
  }, interval);
  timer.unref();
  refreshTimers.set(key, timer);
}
