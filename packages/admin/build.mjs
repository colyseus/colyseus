import path from 'path';
import glob from 'fast-glob';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import esbuild from 'esbuild';

// Mirrors packages/playground/build.mjs.
//
// Vite has already produced index.html + assets/ under build/. This step adds
// the CJS/ESM/.d.ts artifacts for the backend so the package is consumable
// from both Node CJS and ESM consumers.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const basePath = __dirname;

  const entryPoints = glob.sync(
    path.resolve(basePath, 'src-backend', '**', '**.ts').replace(/\\/g, '/'),
  );

  const outdir = path.join(basePath, 'build');

  const emitTSDeclaration = () => {
    console.log('Generating .d.ts...');
    const program = ts.createProgram(entryPoints, {
      declaration: true,
      emitDeclarationOnly: true,
      skipLibCheck: true,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2020,
      outDir: outdir,
      esModuleInterop: true,
    });
    const emitResult = program.emit();
    const allDiagnostics = ts
      .getPreEmitDiagnostics(program)
      .concat(emitResult.diagnostics);
    allDiagnostics.forEach((d) => {
      if (d.file) {
        const { line, character } = ts.getLineAndCharacterOfPosition(d.file, d.start);
        const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
        console.log(`${d.file.fileName} (${line + 1},${character + 1}): ${message}`);
      } else {
        console.log(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      }
    });
  };

  console.log('Generating CJS build...');
  esbuild.build({
    entryPoints,
    outdir,
    format: 'cjs',
    target: 'es2017',
    bundle: true,
    sourcemap: 'external',
    platform: 'node',
    outExtension: { '.js': '.cjs' },
    // `import.meta` has no CJS equivalent — esbuild stubs it to `{}`, so lower
    // it to the per-file CJS values instead of emitting `undefined`.
    define: {
      'import.meta.url': '__cjsImportMetaUrl',
      'import.meta.dirname': '__dirname',
      'import.meta.filename': '__filename',
    },
    banner: { js: "const __cjsImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
    plugins: [{
      name: 'externalize-imports',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.importer) {
            if (args.path.startsWith('.')) {
              return { path: args.path.replace(/\.[jt]sx?$/, '.cjs'), external: true };
            }
            return { path: args.path, external: true };
          }
        });
      },
    }],
  });

  console.log('Generating ESM build...');
  esbuild.build({
    entryPoints,
    outdir,
    target: 'esnext',
    format: 'esm',
    bundle: true,
    sourcemap: 'external',
    platform: 'node',
    outExtension: { '.js': '.mjs' },
    plugins: [{
      name: 'externalize-imports',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.importer) {
            if (args.path.startsWith('.')) {
              return { path: args.path.replace(/\.[jt]sx?$/, '.mjs'), external: true };
            }
            return { path: args.path, external: true };
          }
        });
      },
    }],
  });

  emitTSDeclaration();
  console.log('Done!');
}

export default await main();
