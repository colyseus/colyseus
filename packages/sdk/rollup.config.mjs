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
    {
        input: ['src/index.ts'],
        output: [{ preserveModules: true, banner, dir: 'build', format: 'esm', entryFileNames: '[name].mjs', sourcemap: true },],
        external,
        plugins: [
            replacePlugin,
            typescript({ tsconfig: './tsconfig/tsconfig.esm.json' }),
        ],
    },

    {
        input: ['src/index.ts'],
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
                    // httpie: force `fetch` for web environments
                    { find: '@colyseus/httpie', replacement: path.resolve('./node_modules/@colyseus/httpie/fetch/index.js') },

                    // ws: force browser.js version.
                    { find: 'ws', replacement: path.resolve('./node_modules/ws/browser.js') },

                    // @colyseus/schema: force browser version.
                    { find: '@colyseus/schema', replacement: path.resolve('./node_modules/@colyseus/schema/build/umd/index.js') },
                ]
            }),
            commonjs(),
            nodeResolve({ browser: true }), // "browser" seems to have no effect here. (why??)
        ],
    },

    // Cocos Creator SDK (same as browser/embedded, but use XHR instead of fetch)
    {
        input: ['src/index.ts'],
        output: [
            {
                preserveModules: false,
                banner: `${bannerStatic}\n// THIS VERSION USES "XMLHttpRequest" INSTEAD OF "fetch" FOR COMPATIBILITY WITH COCOS CREATOR`,
                dir: 'dist',
                name: "Colyseus",
                format: 'umd',
                entryFileNames: 'colyseus-cocos-creator.js',
                sourcemap: true,
                amd: { id: pkg.name }
            },
        ],
        plugins: [
            replacePlugin,
            typescript({ tsconfig: './tsconfig/tsconfig.cjs.json' }),
            alias({
                entries: [
                    // httpie: force XHR implementation on browser/UMD environment
                    { find: '@colyseus/httpie', replacement: path.resolve('./node_modules/@colyseus/httpie/xhr/index.js' ) },

                    // ws: force browser.js version.
                    { find: 'ws', replacement: path.resolve('./node_modules/ws/browser.js' ) },

                    // @colyseus/schema: force browser version.
                    { find: '@colyseus/schema', replacement: path.resolve('./node_modules/@colyseus/schema/build/umd/index.js') },
                ]
            }),
            commonjs(),
            nodeResolve({ browser: true }), // "browser" seems to have no effect here. (why??)
        ],

    },

    /**
     * Debug tools
     */
    // standalone dist script that patches global Colyseus
    {
        input: 'src/debug.ts',
        external: ['./Client'],
        treeshake: false,
        output: {
            file: 'dist/debug.js',
            format: 'iife',
            sourcemap: true,
            banner,
            globals: (filename) => {
                return "Colyseus";
            }
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
