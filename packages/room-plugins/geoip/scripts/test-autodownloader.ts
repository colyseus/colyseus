#!/usr/bin/env tsx
/**
 * Manual exercise for `AutoDownloader`. Hits the real MaxMind permalink,
 * extracts the .mmdb, opens it with `MMDBReader`, and runs a few sanity
 * lookups. Kept out of the mocha suite because it needs network access
 * and live MaxMind credentials.
 *
 * Usage:
 *   MAXMIND_ACCOUNT_ID=... MAXMIND_LICENSE_KEY=... \
 *     pnpm tsx scripts/test-autodownloader.ts
 *
 * Flags:
 *   --cache-dir <path>   override default tmp cache directory
 *   --force              ignore any cached copy and re-download
 *   --concurrent <N>     fork N child processes that all call fetch()
 *                        simultaneously — exercises the cross-process
 *                        race fix (PID-scoped temps + recheck-before-rename).
 *                        Verifies all peers end up with the same valid file.
 *
 * Get free GeoLite2 credentials at:
 *   https://www.maxmind.com/en/geolite2/signup
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

import { AutoDownloader } from '../src/readers/AutoDownloader.ts';
import { MMDBReader } from '../src/readers/MMDBReader.ts';

const args = parseArgs(process.argv.slice(2));

if (args.childRunId !== undefined) {
  // Spawned by the --concurrent flag below — run a single fetch and
  // print result + final file checksum so the parent can verify all
  // children converged on the same file.
  await runChild(args.childRunId, args.cacheDir);
  process.exit(0);
}

const accountId = process.env.MAXMIND_ACCOUNT_ID;
const licenseKey = process.env.MAXMIND_LICENSE_KEY;
if (!accountId || !licenseKey) {
  console.error('error: MAXMIND_ACCOUNT_ID and MAXMIND_LICENSE_KEY must be set');
  console.error('  sign up at https://www.maxmind.com/en/geolite2/signup');
  process.exit(1);
}

const cacheDir = args.cacheDir ?? path.join(os.tmpdir(), 'colyseus-geoip-test');

if (args.concurrent && args.concurrent > 1) {
  await runConcurrent(args.concurrent, cacheDir, args.force);
} else {
  await runSingle(accountId, licenseKey, cacheDir, args.force);
}

// ---------------------------------------------------------------------------

async function runSingle(accountId: string, licenseKey: string, cacheDir: string, force: boolean) {
  console.log(`[single] cacheDir=${cacheDir} force=${force}`);
  const downloader = new AutoDownloader({ accountId, licenseKey, cacheDir });
  const t0 = Date.now();
  const dbPath = await downloader.fetch(force);
  const elapsed = Date.now() - t0;
  const size = fs.statSync(dbPath).size;
  console.log(`[single] fetched in ${elapsed}ms — ${dbPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);

  const reader = new MMDBReader(dbPath);
  // 8.8.8.8 → US; 1.1.1.1 → US (Cloudflare anycast, MaxMind reports US); 81.2.69.142 → GB.
  // Both should always resolve in a fresh GeoLite2-Country build.
  for (const ip of ['8.8.8.8', '1.1.1.1', '81.2.69.142', '2001:4860:4860::8888']) {
    const data = reader.lookup(ip);
    console.log(`[single] lookup ${ip} -> ${data ? `${data.isoCode} (${data.name})` : 'undefined'}`);
  }
  console.log('[single] OK');
}

async function runConcurrent(n: number, cacheDir: string, force: boolean) {
  if (force && fs.existsSync(cacheDir)) {
    // Wipe so every child genuinely races on a cold cache.
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
  console.log(`[race] spawning ${n} child processes, cacheDir=${cacheDir}`);

  const selfPath = fileURLToPath(import.meta.url);
  const children = Array.from({ length: n }, (_, i) =>
    spawnChild(selfPath, i, cacheDir),
  );
  const results = await Promise.all(children);

  console.log('\n[race] results:');
  for (const r of results) {
    console.log(`  child=${r.id} exit=${r.code} sha256=${r.sha256 ?? 'n/a'} bytes=${r.bytes ?? 'n/a'}`);
  }

  const hashes = new Set(results.filter(r => r.sha256).map(r => r.sha256!));
  if (hashes.size === 1 && results.every(r => r.code === 0)) {
    console.log(`[race] OK — all ${n} children converged on the same .mmdb (sha256=${[...hashes][0]})`);
  } else {
    console.error(`[race] FAIL — got ${hashes.size} distinct file hashes, or non-zero exits`);
    process.exit(2);
  }
}

interface ChildResult { id: number; code: number; sha256?: string; bytes?: number; }

function spawnChild(selfPath: string, id: number, cacheDir: string): Promise<ChildResult> {
  return new Promise((resolve) => {
    const child = spawn(
      'node',
      ['--experimental-strip-types', selfPath, '--child-run-id', String(id), '--cache-dir', cacheDir],
      { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let buf = '';
    child.stdout.on('data', (chunk) => { buf += chunk.toString(); });
    child.on('close', (code) => {
      const match = buf.match(/sha256=([0-9a-f]+) bytes=(\d+)/);
      resolve({
        id,
        code: code ?? -1,
        sha256: match?.[1],
        bytes: match ? parseInt(match[2], 10) : undefined,
      });
    });
  });
}

async function runChild(id: number, cacheDir: string | undefined) {
  const accountId = process.env.MAXMIND_ACCOUNT_ID!;
  const licenseKey = process.env.MAXMIND_LICENSE_KEY!;
  const resolvedCacheDir = cacheDir ?? path.join(os.tmpdir(), 'colyseus-geoip-test');
  const downloader = new AutoDownloader({ accountId, licenseKey, cacheDir: resolvedCacheDir });
  try {
    const t0 = Date.now();
    const dbPath = await downloader.fetch(false);
    const elapsed = Date.now() - t0;
    const buf = fs.readFileSync(dbPath);
    const { createHash } = await import('crypto');
    const sha256 = createHash('sha256').update(buf).digest('hex');
    // Parent parses this line.
    process.stdout.write(`child=${id} elapsed=${elapsed}ms sha256=${sha256} bytes=${buf.length}\n`);
  } catch (e: any) {
    process.stderr.write(`child=${id} ERROR ${e?.message ?? e}\n`);
    process.exit(1);
  }
}

interface Args { cacheDir?: string; force: boolean; concurrent?: number; childRunId?: number; }

function parseArgs(argv: string[]): Args {
  const out: Args = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cache-dir') { out.cacheDir = argv[++i]; }
    else if (a === '--force') { out.force = true; }
    else if (a === '--concurrent') { out.concurrent = parseInt(argv[++i], 10); }
    else if (a === '--child-run-id') { out.childRunId = parseInt(argv[++i], 10); }
    else { console.error(`unknown arg: ${a}`); process.exit(64); }
  }
  return out;
}
