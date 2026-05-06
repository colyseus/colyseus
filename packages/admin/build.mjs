import fs from 'fs';
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
    }, {
      // ESM doesn't have __dirname; transparently rewrite to fileURLToPath(import.meta.url)
      name: 'dirname',
      setup(build) {
        build.onLoad({ filter: /.*/ }, ({ path: filePath }) => {
          let contents = fs.readFileSync(filePath, 'utf8');
          const loader = path.extname(filePath).substring(1);
          contents = contents.replace(/__dirname/g, `path.dirname(fileURLToPath(import.meta.url))`);
          return { contents, loader };
        });
      },
    }],
  });

  emitTSDeclaration();
  console.log('Done!');
}

export default await main();
