import fs from 'fs';
import path from 'path';
import util from 'util';
import { fileURLToPath } from 'url';
import minimist from 'minimist';

import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonJs from '@rollup/plugin-commonjs'
import externals from 'rollup-plugin-node-externals';

import { getPackages } from '@lerna/project';
import { filterPackages } from '@lerna/filter-packages';
import batchPackages from '@lerna/batch-packages';

// we need to change up how __dirname is used for ES6 purposes
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Get a list of the non-private sorted packages
 */
async function getSortedPackages(scope, ignore) {
  const packages = await getPackages(__dirname);
  const filtered = filterPackages(packages,
    scope,
    ignore,
    false);

  return batchPackages(filtered)
    .reduce((arr, batch) => arr.concat(batch), []);
}

async function main() {

  // Support --scope and --ignore globs if passed in via commandline
  const { scope, ignore } = minimist(process.argv.slice(2));
  const packages = await getSortedPackages(scope, ignore);

  const configs = packages.map(pkg => {
    // Absolute path to package directory
    const basePath = path.relative(__dirname, pkg.location);

    // "main" field from package.json file.
    const pkgJSON = pkg.toJSON();

    // Absolute path to input file
    const input = path.join(basePath, pkgJSON.input);

    // Skip rollup build if package has "build" configured.
    if (pkgJSON.scripts?.build) {
      console.log(pkgJSON.name, "has custom build! skipping rollup build.");
      return;
    }

    // Copy README.md and LICENSE into child package folder.
    if (!fs.existsSync(path.join(basePath, "README.md"))) {
      fs.copyFileSync(path.resolve(__dirname, "README.md"), path.join(basePath, "README.md"));
      fs.copyFileSync(path.resolve(__dirname, "LICENSE"), path.join(basePath, "LICENSE"));
    }

    const tsconfig = {
      rootDir: path.join(basePath, "src"),
      declarationDir: path.join(basePath, "build"),
      declaration: true,
      include: [path.join(basePath, "src", "**", "*.ts")],
    };

    //
    // Here's the individual rollup.config.js for each package
    // Uses two separate builds: one for CJS and other for ESM.
    //
    return [{
      input,
      preserveModules: true,
      output: [
        { dir: path.join(basePath, 'build'), format: 'cjs', sourcemap: true },
      ],
      plugins: [
        externals({ deps: true, peerDeps: true, packagePath: path.join(basePath, "package.json"), }),
        nodeResolve(),
        commonJs(),
        typescript({
          ...tsconfig,
          module: "ESNext",
          target: "es2015",
        }),
      ],

    }, {
      input,
      preserveModules: true,
      output: [
        { dir: path.join(basePath, 'build'), format: 'esm', entryFileNames: '[name].mjs', sourcemap: true },
      ],
      plugins: [
        externals({ deps: true, peerDeps: true, packagePath: path.join(basePath, "package.json"), }),
        nodeResolve(),
        commonJs(),
        typescript({
          ...tsconfig,
          module: "ESNext",
          target: "ESNext",
        }),
      ],
    }];
  });

  console.log("ROLLUP CONFIGS:", util.inspect(configs, false, Infinity, true));

  return configs.filter(c => c !== undefined);
}

export default (await main()).flat();
