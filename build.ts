import fs from 'fs';
import path from 'path';
import glob from 'fast-glob';
import { fileURLToPath } from 'url';
import minimist from 'minimist';
import ts from "typescript";
import micromatch from 'micromatch';

import esbuild from "esbuild";

// we need to change up how __dirname is used for ES6 purposes
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Get a list of the non-private sorted packages
 */
function getAllPackages(scope?: string | string[], ignore?: string | string[]) {
  // Read workspace globs from pnpm-workspace.yaml
  const content = fs.readFileSync(path.join(__dirname, 'pnpm-workspace.yaml'), 'utf-8');
  const workspaceGlobs: string[] = [];
  let inPackages = false;
  for (const line of content.split('\n')) {
    if (line.trim() === 'packages:') { inPackages = true; continue; }
    if (inPackages) {
      const match = line.match(/^\s+-\s+(.+)/);
      if (match) {
        workspaceGlobs.push(match[1].trim().replace(/['"]/g, ''));
      } else if (line.trim() && !line.startsWith(' ') && !line.startsWith('\t')) {
        break;
      }
    }
  }

  // Discover all package.json files matching workspace globs
  const patterns = workspaceGlobs.map(g => `${g}/package.json`);
  const packageJsonPaths = glob.sync(patterns, {
    cwd: __dirname,
    absolute: true,
    ignore: ['**/node_modules/**'],
  });

  // Parse packages, filter out private ones
  let packages = packageJsonPaths.map(pkgPath => {
    const pkgJSON = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return { name: pkgJSON.name as string, location: path.dirname(pkgPath), toJSON: () => pkgJSON };
  }).filter(pkg => !pkg.toJSON().private);

  // Apply --scope / --ignore filtering
  if (scope || ignore) {
    const names = packages.map(p => p.name);
    const patterns: string[] = [];

    if (scope) {
      patterns.push(...(Array.isArray(scope) ? scope : [scope]));
    } else {
      patterns.push('**');
    }

    if (ignore) {
      const excludes = Array.isArray(ignore) ? ignore : [ignore];
      patterns.push(...excludes.map(p => `!${p}`));
    }

    const matched = new Set(micromatch(names, patterns));
    packages = packages.filter(p => matched.has(p.name));
  }

  return packages;
}

async function main() {

  // Support --scope and --ignore globs if passed in via commandline
  const argv = minimist(process.argv.slice(2).filter(arg => arg !== '--'));

  const packages = getAllPackages(argv.scope, argv.ignore);

  packages.map(pkg => {
    // Absolute path to package directory
    const basePath = path.relative(__dirname, pkg.location);

    // "main" field from package.json file.
    const pkgJSON = pkg.toJSON();

    // Skip rollup build if package has "build" configured.
    if (pkgJSON.scripts?.build) {
      console.log(pkgJSON.name, "has custom build! skipping default build.");
      return;
    }

    // Copy README.md and LICENSE into child package folder.
    if (!fs.existsSync(path.join(basePath, "README.md"))) {
      fs.copyFileSync(path.resolve(__dirname, "README.md"), path.join(basePath, "README.md"));
      fs.copyFileSync(path.resolve(__dirname, "LICENSE"), path.join(basePath, "LICENSE"));
    }

    // Get all .ts as input files
    const entrypoints = glob.sync(path.resolve(basePath, "src", "**", "**.ts")
      .replace(/\\/g, '/')); // windows support

    const outdir = path.join(basePath, 'build');

    // Emit only .d.ts files
    const emitTSDeclaration = () => {
      console.log("Generating .d.ts files for...", pkgJSON.name);
      const program = ts.createProgram(entrypoints, {
        rootDir: path.join(basePath, "src"),
        declaration: true,
        emitDeclarationOnly: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        // module: ts.ModuleKind.CommonJS,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ESNext,
        lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
        outDir: outdir,
        downlevelIteration: true, // (redis-driver)
        esModuleInterop: true,
        experimentalDecorators: true,
        allowImportingTsExtensions: true,
        customConditions: ["@source"],
      });
      const emitResult = program.emit();

      const allDiagnostics = ts
        .getPreEmitDiagnostics(program)
        .concat(emitResult.diagnostics);

      allDiagnostics.forEach(diagnostic => {
        if (diagnostic.file) {
          const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start);
          const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
          console.log(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
        } else {
          console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
        }
      });
    }

    // CommonJS output
    esbuild.build({
      entryPoints: entrypoints,
      outdir,
      format: "cjs",
      bundle: true,
      sourcemap: "external",
      platform: "node",
      outExtension: { '.js': '.cjs', },
      plugins: [{
        name: 'add-cjs',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.importer) {
              if (args.path.startsWith('.')) {
                return { path: args.path.replace(/\.[jt]sx?$/, '.cjs'), external: true }
              }
              return { path: args.path, external: true }
            }
          })
        },
      }],
    });

    // ESM output
    esbuild.build({
      entryPoints: entrypoints,
      outdir,
      format: "esm",
      bundle: true,
      sourcemap: "external",
      platform: "node",
      outExtension: { '.js': '.mjs', },
      plugins: [{
        name: 'add-mjs',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.importer) {
              if (args.path.startsWith('.')) {
                return { path: args.path.replace(/\.[jt]sx?$/, '.mjs'), external: true }
              }
              return { path: args.path, external: true }
            }
          })
        },
      }],
    });

    // emit .d.ts files
    emitTSDeclaration();
  });
}

export default await main();
