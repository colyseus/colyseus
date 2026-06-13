import path from "path";
import typescript from '@rollup/plugin-typescript';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import alias from '@rollup/plugin-alias';
import replace from '@rollup/plugin-replace';

// import as json
import pkg from "./package.json" with { type: "json" };
import schemapkg from "./node_modules/@colyseus/schema/package.json" with { type: "json" };

const external = Object.keys(pkg.dependencies);

const banner = `// Copyright (c) ${new Date().getFullYear()} Endel Dreyer.\n//\n// This software is released under the MIT License.\n// https://opensource.org/license/MIT\n//\n// colyseus.js@${pkg.version}`;
const bannerStatic = `${banner} - @colyseus/schema ${schemapkg.version}`;

const replacePlugin = replace({
    'process.env.VERSION': JSON.stringify(pkg.version),
    preventAssignment: true,
});

export default [

    // https://github.com/microsoft/TypeScript/issues/18442#issuecomment-749896695
    // `src/predict.ts` is listed alongside `src/index.ts` so the barrel emits
    // as a standalone `build/predict.{mjs,cjs}` (matching the `./*` exports
    // rule for `@colyseus/sdk/predict`); without a second entry rollup would
    // inline the thin barrel into `index.mjs` and the subpath would 404.
    {
        input: ['src/index.ts', 'src/predict.ts'],
        output: [{ preserveModules: true, banner, dir: 'build', format: 'esm', entryFileNames: '[name].mjs', sourcemap: true },],
        external,
        plugins: [
            replacePlugin,
            typescript({ tsconfig: './tsconfig/tsconfig.esm.json' }),
        ],
    },

    {
        input: ['src/index.ts', 'src/predict.ts'],
        output: [{ preserveModules: true, banner, dir: 'build', format: 'cjs', entryFileNames: '[name].cjs', sourcemap: true },],
        external,
        plugins: [
            replacePlugin,
            typescript({ tsconfig: './tsconfig/tsconfig.cjs.json' }),
        ],
    },

    // browser/embedded dependencies
    {
        input: ['src/index.ts'],
        output: [
            {
                preserveModules: false,
                banner: bannerStatic,
                dir: 'dist',
                name: "Colyseus",
                format: 'umd',
                entryFileNames: 'colyseus.js',
                sourcemap: true,
                amd: { id: pkg.name }
            },
        ],
        plugins: [
            replacePlugin,
            typescript({ tsconfig: './tsconfig/tsconfig.cjs.json' }),
            alias({
                entries: [
                    // ws: force browser.js version.
                    { find: 'ws', replacement: path.resolve('./node_modules/ws/browser.js') },

                    // @colyseus/schema: force browser version.
                    // Subpath /input is matched first to avoid the bare alias swallowing it.
                    { find: '@colyseus/schema/input', replacement: path.resolve('./node_modules/@colyseus/schema/build/input/index.mjs') },
                    { find: '@colyseus/schema', replacement: path.resolve('./node_modules/@colyseus/schema/build/index.js') },
                ]
            }),
            commonjs(),
            nodeResolve({ browser: true }),
        ],
    },

    /**
     * Debug tools
     */
    // standalone dist script that patches global Colyseus
    {
        input: 'src/debug.ts',
        // Bundle the debug source tree (src/debug.ts + src/debug/**); everything
        // else (the SDK, schema, …) is provided by the global `Colyseus`.
        // Resolve relative specifiers against their importer so sibling imports
        // like "./core.ts" (from src/debug/panel.ts) are recognised as local.
        external: (id, importer) => {
            if (id === 'src/debug.ts' || id.startsWith('\0')) { return false; }
            const abs = (id.startsWith('.') && importer)
                ? path.resolve(path.dirname(importer), id)
                : id;
            const debugEntry = path.resolve('src/debug.ts');
            const debugDir = path.resolve('src/debug') + path.sep;
            return !(abs === debugEntry || abs.startsWith(debugDir));
        },
        treeshake: false,
        output: {
            file: 'dist/debug.js',
            format: 'iife',
            sourcemap: true,
            banner,
            globals: (id) => "Colyseus",
        },
        plugins: [
            typescript({ tsconfig: './tsconfig/tsconfig.cjs.json' }),
        ],
    },
    // Debug ESM build
    {
        input: 'src/debug.ts',
        treeshake: false,
        output: [{ preserveModules: true, banner, dir: 'build', format: 'esm', entryFileNames: '[name].mjs', sourcemap: true },],
        external,
        plugins: [ replacePlugin, typescript({ tsconfig: './tsconfig/tsconfig.esm.json' }), ],
    },
    // Debug CJS build
    {
        input: 'src/debug.ts',
        treeshake: false,
        output: [{ preserveModules: true, banner, dir: 'build', format: 'cjs', entryFileNames: '[name].cjs', sourcemap: true },],
        external,
        plugins: [ replacePlugin, typescript({ tsconfig: './tsconfig/tsconfig.cjs.json' }), ],
    },

];
