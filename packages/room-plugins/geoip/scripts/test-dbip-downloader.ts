#!/usr/bin/env tsx
/**
 * Manual exercise for `DBIPDownloader`. Hits db-ip.com for real, unwraps
 * the .mmdb.gz, opens it with `MMDBReader` and runs a few sanity lookups.
 * Kept out of the mocha suite because it needs network access — the suite
 * covers everything up to the request with cached snapshots.
 *
 * Usage:
 *   pnpm tsx scripts/test-dbip-downloader.ts [--cache-dir <path>]
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { DBIPDownloader, recentMonths } from '../src/readers/DBIPDownloader.ts';
import { MMDBReader } from '../src/readers/MMDBReader.ts';

const argv = process.argv.slice(2);
const cacheDir = argv.includes('--cache-dir')
  ? argv[argv.indexOf('--cache-dir') + 1]
  : fs.mkdtempSync(path.join(os.tmpdir(), 'dbip-manual-'));

const [current, previous] = recentMonths(new Date());
console.log(`cache dir: ${cacheDir}`);
console.log(`months:    ${current} (fallback ${previous})\n`);

const downloader = new DBIPDownloader({ cacheDir });

const started = Date.now();
const dbPath = await downloader.fetch();
const size = fs.statSync(dbPath).size;
console.log(`\ndownloaded ${path.basename(dbPath)} — ${(size / 1024 / 1024).toFixed(1)} MB in ${Date.now() - started}ms`);

const reader = new MMDBReader(dbPath);
for (const ip of ['81.2.69.142', '8.8.8.8', '2001:218::1', '127.0.0.1']) {
  console.log(`  ${ip.padEnd(14)} → ${JSON.stringify(reader.lookup(ip)) ?? 'undefined'}`);
}

// A second call must be a pure cache hit: same path, no request.
const again = Date.now();
const cached = await downloader.fetch();
console.log(`\nsecond fetch: ${cached === dbPath ? 'cache hit' : 'MISMATCH'} in ${Date.now() - again}ms`);
console.log(`cache holds: ${fs.readdirSync(cacheDir).join(', ')}`);
