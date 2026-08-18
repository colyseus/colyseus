// Packaging smoke test: load every `exports` subpath of every BUILT workspace
// package under both the `require` (CJS) and `import` (ESM) conditions.
//
// Guards module-scope throws that exist in only one output format — e.g. a
// `fileURLToPath(import.meta.url)` that esbuild stubs to `undefined` in the CJS
// bundle, killing `require("colyseus")` before any user code runs. Nothing else
// in CI loads the built artifacts: the test suites resolve the `@source`
// condition, so they never see the bundles consumers actually get.
//
// Run AFTER `pnpm build-all` (it loads `build/*`). Exits non-zero on any failure.
import { createRequire } from 'node:module';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import glob from 'fast-glob';

// Subpaths that cannot load under plain Node — environment limits, not packaging bugs.
const SKIP = new Map([
  ['@colyseus/bun-websockets', 'requires the bun runtime'],
  ['@colyseus/sdk/debug', 'browser-only (touches `document`)'],
  ['@colyseus/h3-transport', '@fails-components/webtransport ships no `exports` main'],
  // Registers a mongoose model at module scope, so the CJS and ESM copies
  // collide when both load in one process. Each format is fine on its own.
  ['@colyseus/mongoose-driver', 'dual-package hazard: module-scope mongoose.model()'],
]);
const skipReason = (spec) => SKIP.get(spec) ?? SKIP.get(spec.split('/').slice(0, 2).join('/'));

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

// Same workspace globs pnpm uses, minus the vendored better-call submodule.
const workspace = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')
  .split('\n').map((l) => l.match(/^\s+-\s+(.+)/)?.[1].trim().replace(/['"]/g, ''))
  .filter((g) => g && !g.includes('better-call'));

const pkgPaths = glob.sync(workspace.map((g) => `${g}/package.json`), {
  cwd: root, absolute: true, ignore: ['**/node_modules/**'],
});

const targetsOf = (value) => typeof value === 'string'
  ? { require: value, import: value }
  : { require: value?.require, import: value?.import ?? value?.browser };

// Expand `exports` into { spec, mjs } pairs. A `./*` wildcard expands to the
// top-level modules actually emitted, so a broken internal module is caught too
// — not just the package entry point.
function subpathsOf(pkg, dir) {
  const out = new Map();
  for (const [key, value] of Object.entries(pkg.exports ?? {})) {
    if (!key.startsWith('.')) { continue; }
    const t = targetsOf(value);
    if (!t.require || !/\.[cm]?js$/.test(t.require)) { continue; } // e.g. "./package.json"

    if (!key.includes('*')) {
      out.set(key === '.' ? pkg.name : `${pkg.name}/${key.slice(2)}`, t.import);
      continue;
    }
    const globDir = path.join(dir, path.dirname(t.require));
    if (!existsSync(globDir)) { continue; }
    for (const file of readdirSync(globDir)) {
      if (!file.endsWith('.cjs')) { continue; }
      const name = file.replace(/\.cjs$/, '');
      out.set(`${pkg.name}/${key.slice(2).replace('*', name)}`, t.import?.replace('*', name));
    }
  }
  return out;
}

let failed = 0, checked = 0;
const skipped = [];

for (const pkgPath of pkgPaths.sort()) {
  const pkg = readJSON(pkgPath);
  const dir = path.dirname(pkgPath);
  if (pkg.private || !existsSync(path.join(dir, 'build'))) { continue; }

  // Resolve from inside the package so Node's self-reference applies — the
  // `require` leg exercises the real `exports` map, not a hand-built path.
  // The `import` leg loads the mapped `.mjs` directly: Node has no API to
  // resolve a bare specifier under the `import` condition from another dir.
  const require = createRequire(pkgPath);

  for (const [spec, importTarget] of subpathsOf(pkg, dir)) {
    const reason = skipReason(spec);
    if (reason) { skipped.push(`${spec} (${reason})`); continue; }

    const legs = [['require', () => require(spec)]];
    if (importTarget) {
      legs.push(['import ', () => import(pathToFileURL(path.join(dir, importTarget)).href)]);
    }
    for (const [label, load] of legs) {
      checked++;
      try {
        await load();
      } catch (err) {
        failed++;
        console.error(`  ${label} ${spec} — FAIL: ${err.message.split('\n')[0]}`);
      }
    }
  }
}

for (const s of skipped) { console.log(`  skip    ${s}`); }
if (failed > 0) {
  console.error(`\nverify-exports: ${failed}/${checked} check(s) failed.`);
  process.exit(1);
}
console.log(`\nverify-exports: all ${checked} check(s) pass under require + import.`);
