/*
 * rollup is used to generate the ESM version of `colyseus`
 */

import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonJs from '@rollup/plugin-commonjs'
import externals from 'rollup-plugin-node-externals';

export default [
    {
        preserveModules: true,
        input: ['src/index.ts'],
        output: [
            { dir: 'esm', format: 'esm', entryFileNames: '[name].mjs', sourcemap: true },
        ],
        plugins: [
            externals({ deps: true, peerDeps: true, packagePath: "./package.json", }),
            nodeResolve(),
            commonJs(),
            typescript({ tsconfig: './tsconfig/tsconfig.esm.json' }),
        ],
    },
];
