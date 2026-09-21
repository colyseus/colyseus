import fs from 'fs';
import path from 'path';
import os from 'os';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { logger } from '@colyseus/core';

/**
 * Downloads DB-IP's Lite Country database. Free and unauthenticated —
 * they publish one month-stamped file per month at a stable public URL.
 *
 * We fetch instead of shipping the `.mmdb` inside `@colyseus/geoip`: the
 * package stays ~100 KB rather than 8.4 MB, the data follows DB-IP's
 * monthly rebuild rather than our release cadence, and nothing is
 * redistributed — every copy travels from DB-IP to the operator's machine.
 *
 * DB-IP Lite is CC BY 4.0; attribution is required when you display
 * results. See this package's README.
 *
 * https://db-ip.com/db/lite.php
 */
export interface DBIPDownloaderOptions {
  /** Where to cache the .mmdb. Defaults to `<os.tmpdir()>/colyseus-geoip`. */
  cacheDir?: string;
}

const BASE_URL = 'https://download.db-ip.com/free';
const SNAPSHOT = /^dbip-country-lite-\d{4}-\d{2}\.mmdb$/;

export class DBIPDownloader {
  private cacheDir: string;

  constructor(opts: DBIPDownloaderOptions = {}) {
    this.cacheDir = opts.cacheDir ?? path.join(os.tmpdir(), 'colyseus-geoip');
  }

  /** Absolute path of a `YYYY-MM` snapshot, downloaded or not. */
  dbPathFor(month: string): string {
    return path.join(this.cacheDir, `dbip-country-lite-${month}.mmdb`);
  }

  /**
   * Resolve a database file, downloading it only when we don't have it.
   *
   * Snapshots are month-stamped, so "am I current?" is a plain
   * `existsSync` and a check that finds nothing new costs no network.
   * The previous month is the fallback: DB-IP publishes on the 1st, and
   * until the new file lands last month's is the freshest one there is.
   */
  async fetch(now: Date = new Date()): Promise<string> {
    const [current, previous] = recentMonths(now);
    if (fs.existsSync(this.dbPathFor(current))) { return this.keepOnly(current); }

    try {
      await this.download(current);
      return this.keepOnly(current);
    } catch {
      // Routine at the turn of a month, so it stays quiet.
      if (fs.existsSync(this.dbPathFor(previous))) { return this.keepOnly(previous); }
      await this.download(previous);
      return this.keepOnly(previous);
    }
  }

  /**
   * Stage into a PID-scoped temp path and rename into place, so peer
   * processes sharing a `cacheDir` never clobber each other's partial
   * writes — the rename is the only shared write, and it's atomic on POSIX.
   */
  private async download(month: string): Promise<void> {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const dbPath = this.dbPathFor(month);
    const tmp = `${dbPath}.${process.pid}.${Date.now()}.tmp`;

    try {
      logger.info(`@colyseus/geoip: fetching DB-IP Lite Country ${month} (~4 MB) into ${this.cacheDir}`);
      const res = await fetch(`${BASE_URL}/dbip-country-lite-${month}.mmdb.gz`);
      if (!res.ok || !res.body) {
        throw new Error(`[geoip] DB-IP download failed for ${month}: ${res.status} ${res.statusText}`);
      }
      // Served as a plain .mmdb.gz — unwrap straight to disk, no intermediate file.
      await pipeline(Readable.fromWeb(res.body as any), zlib.createGunzip(), fs.createWriteStream(tmp));
      fs.renameSync(tmp, dbPath);
    } finally {
      safeUnlink(tmp);
    }
  }

  /** Drop superseded snapshots — each one is 8 MB, and they'd pile up monthly. */
  private keepOnly(month: string): string {
    const keep = this.dbPathFor(month);
    for (const name of fs.readdirSync(this.cacheDir)) {
      const file = path.join(this.cacheDir, name);
      if (SNAPSHOT.test(name) && file !== keep) { safeUnlink(file); }
    }
    return keep;
  }
}

/** `YYYY-MM` for the given month and the one before it. */
export function recentMonths(now: Date): [string, string] {
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return [stamp(now), stamp(previous)];
}

function stamp(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function safeUnlink(p: string): void {
  try { fs.unlinkSync(p); } catch { /* already gone or never created */ }
}
