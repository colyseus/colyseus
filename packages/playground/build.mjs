import fs from 'fs';
import path from 'path';
import glob from 'fast-glob';
import { fileURLToPath } from 'url';
import ts from "typescript";
import esbuild from "esbuild";

// we need to change up how __dirname is used for ES6 purposes
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Absolute path to package directory
  const basePath = __dirname;
  const target = "es2020";

  // Get all .ts as input files
  const entryPoints = glob.sync(path.resolve(basePath, "src-backend", "**", "**.ts")
    .replace(/\\/g, '/')); // windows support

  const outdir = path.join(basePath, 'build');

  // Emit only .d.ts files
  const emitTSDeclaration = () => {
    console.log("Generating .d.ts...");
    const program = ts.createProgram(entryPoints, {
      declaration: true,
      emitDeclarationOnly: true,
      skipLibCheck: true,
      module: "commonjs",
      target,
      outDir: outdir,
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
  console.log("Generating CJS build...");
  esbuild.build({
    entryPoints,
    outdir,
    format: "cjs",
    target: "es2017",
    sourcemap: "external",
    platform: "node",
  });

  // ESM output
  console.log("Generating ESM build...");
  esbuild.build({
    entryPoints,
    outdir,
    target: "esnext",
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
    }, {

      //
      // WORKAROUND FOR __dirname usage in ESM
      // TODO: need to have a better appraoch for ESM + CJS builds...
      //
      name: 'dirname',
      setup(build) {
        build.onLoad({ filter: /.*/ }, ({ path: filePath }) => {
          let contents = fs.readFileSync(filePath, "utf8");
          const loader = path.extname(filePath).substring(1);
          contents = contents.replace("__dirname", `path.dirname(fileURLToPath(import.meta.url))`)
          return {
            contents,
            loader,
          };
        });
      }

    }]
  });

  // emit .d.ts files
  emitTSDeclaration();
  console.log("Done!");
}

export default await main();
