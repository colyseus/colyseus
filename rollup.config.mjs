import path from 'path';
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
    console.log({ basePath });

    // "main" field from package.json file.
    const pkgJSON = pkg.toJSON();

    // Absolute path to input file
    const input = path.join(basePath, pkgJSON.input);

    console.log({
      pkgLocation: pkg.location,
      input,
      cjsDIR: path.join(basePath, 'build', 'cjs'),
      esmDIR: path.join(basePath, 'build', 'esm'),
      tsconfig: path.join(basePath, 'tsconfig', 'tsconfig.esm.json'),
    })

    //
    // Here's the individual rollup.config.js for each package
    //
    return ({
      input,
      preserveModules: true,
      output: [
        {
          dir: path.join(basePath, 'build'),
          format: 'cjs',
          sourcemap: true
        },
        {
          dir: path.join(basePath, 'build'),
          format: 'esm',
          entryFileNames: '[name].mjs',
          sourcemap: true
        },
      ],
      plugins: [
        externals({
          deps: true,
          peerDeps: true,
          packagePath: path.join(basePath, "package.json"),
        }),
        nodeResolve(),
        commonJs(),
        typescript({
          // declarationDir: path.join(basePath, "build"),
          tsconfig: path.join(basePath, 'tsconfig', 'tsconfig.esm.json')
        }),
      ],
    });
  });

  console.log("ROLLUP CONFIGS:", configs);

  return configs;
}

export default await main();