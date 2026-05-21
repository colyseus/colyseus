import fs from 'fs';
import path from 'path';
import os from 'os';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

/**
 * Downloads MaxMind's GeoLite2-Country database via the official
 * permalink endpoint, authenticated with the user's account id + license
 * key. The file lands at `<cacheDir>/GeoLite2-Country.mmdb` atomically
 * (written to a temp path, then renamed).
 *
 * MaxMind's terms permit the account holder to download under their own
 * credentials; this helper does not redistribute MaxMind data. The
 * fetched file lives only on the operator's machine.
 *
 * https://dev.maxmind.com/geoip/updating-databases/#directly-downloading-databases
 */
export interface AutoDownloaderOptions {
  accountId: string;
  licenseKey: string;
  /** Where to cache the .mmdb. Defaults to `<os.tmpdir()>/colyseus-geoip`. */
  cacheDir?: string;
  /** Edition to fetch. Defaults to GeoLite2-Country. */
  edition?: string;
}

const DEFAULT_EDITION = 'GeoLite2-Country';
const PERMALINK = 'https://download.maxmind.com/app/geoip_download';

export class AutoDownloader {
  private accountId: string;
  private licenseKey: string;
  private cacheDir: string;
  private edition: string;

  constructor(opts: AutoDownloaderOptions) {
    this.accountId = opts.accountId;
    this.licenseKey = opts.licenseKey;
    this.cacheDir = opts.cacheDir ?? path.join(os.tmpdir(), 'colyseus-geoip');
    this.edition = opts.edition ?? DEFAULT_EDITION;
  }

  /** Absolute path to the cached database file (whether or not it exists yet). */
  get dbPath(): string {
    return path.join(this.cacheDir, `${this.edition}.mmdb`);
  }

  /**
   * Fetch the database. Skips the network round-trip when a cached copy
   * exists *and* `force` is not set — callers refresh on a schedule.
   *
   * Cross-process safety: peer processes targeting the same `cacheDir`
   * each stage to their own PID-scoped temp paths, so concurrent fetches
   * never clobber each other's intermediate writes. The final
   * `renameSync` is atomic on POSIX; whichever process commits last
   * wins, and both end up reading a complete, consistent .mmdb. We also
   * recheck `existsSync` right before commit so a process that finishes
   * second can drop its copy if a peer beat it across the line.
   */
  async fetch(force = false): Promise<string> {
    if (!force && fs.existsSync(this.dbPath)) { return this.dbPath; }
    fs.mkdirSync(this.cacheDir, { recursive: true });

    const suffix = `.${process.pid}.${Date.now()}.tmp`;
    const tmpTarPath = `${this.dbPath}.tar.gz${suffix}`;
    const tmpMMDB = `${this.dbPath}${suffix}`;

    try {
      const url = `${PERMALINK}?edition_id=${encodeURIComponent(this.edition)}&license_key=${encodeURIComponent(this.licenseKey)}&suffix=tar.gz`;
      const auth = Buffer.from(`${this.accountId}:${this.licenseKey}`).toString('base64');
      const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (!res.ok || !res.body) {
        throw new Error(`[geoip] MaxMind download failed: ${res.status} ${res.statusText}`);
      }

      // The permalink returns a gzipped tarball; we extract just the .mmdb.
      await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmpTarPath));
      this.extractMMDBTo(tmpTarPath, tmpMMDB);

      // Late recheck: a peer may have finished its own download while we
      // were busy. Prefer their committed file over ours — both are
      // structurally valid; theirs is already in place.
      if (!force && fs.existsSync(this.dbPath)) {
        safeUnlink(tmpMMDB);
      } else {
        fs.renameSync(tmpMMDB, this.dbPath);
      }
    } finally {
      safeUnlink(tmpTarPath);
      safeUnlink(tmpMMDB);
    }

    return this.dbPath;
  }

  /**
   * Pull the single `.mmdb` entry out of MaxMind's gzipped tar and write
   * it to `outPath`. The caller is responsible for the eventual atomic
   * rename to `this.dbPath` — staging via a PID-scoped temp path is what
   * keeps concurrent peers from clobbering each other.
   *
   * We avoid pulling in a tar dependency by parsing the well-known
   * POSIX-ustar headers inline — the archive always has the same shape:
   * directory + .mmdb + COPYRIGHT + LICENSE.
   */
  private extractMMDBTo(tarGzPath: string, outPath: string): void {
    const gz = fs.readFileSync(tarGzPath);
    const tar = zlib.gunzipSync(gz);
    const BLOCK = 512;
    for (let offset = 0; offset + BLOCK <= tar.length; ) {
      const header = tar.subarray(offset, offset + BLOCK);
      const name = header.subarray(0, 100).toString('utf8').replace(/\0+$/, '');
      if (!name) { break; }
      const sizeStr = header.subarray(124, 136).toString('utf8').replace(/[\0 ]+$/, '');
      const size = parseInt(sizeStr, 8) || 0;
      offset += BLOCK;
      if (name.endsWith('.mmdb')) {
        fs.writeFileSync(outPath, tar.subarray(offset, offset + size));
        return;
      }
      offset += Math.ceil(size / BLOCK) * BLOCK;
    }
    throw new Error('[geoip] no .mmdb entry found in MaxMind archive');
  }
}

function safeUnlink(p: string): void {
  try { fs.unlinkSync(p); } catch { /* already gone or never created */ }
}
