import fs from 'fs';
import path from 'path';
import glob from 'fast-glob';
import { fileURLToPath } from 'url';
import minimist from 'minimist';
import ts from "typescript";

import { getPackages } from '@lerna/project';
import { filterPackages } from '@lerna/filter-packages';

import esbuild from "esbuild";

// we need to change up how __dirname is used for ES6 purposes
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Get a list of the non-private sorted packages
 */
async function getAllPackages(scope, ignore) {
  const packages = await getPackages(__dirname);
  return filterPackages(packages, scope, ignore, false);
}

async function main() {

  // Support --scope and --ignore globs if passed in via commandline
  const argv = minimist(process.argv.slice(2));

  const packages = await getAllPackages(argv.scope, argv.ignore);

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
        declaration: true,
        emitDeclarationOnly: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2015,
        lib: ["lib.es2022.d.ts"],
        outDir: outdir,
        downlevelIteration: true, // (redis-driver)
        esModuleInterop: true,
        experimentalDecorators: true,
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
      sourcemap: "external",
      platform: "node",
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
            if (args.importer) return { path: args.path.replace(/^\.(.*)\.js$/, '.$1.mjs'), external: true }
          })
        },
      },
      ],
    });

    // emit .d.ts files
    emitTSDeclaration();
  });
}

export default await main();
