#!/usr/bin/env node
import path from 'path';
import tsnode from 'ts-node';
import { fileURLToPath } from 'url';

// we need to change up how __dirname is used for ES6 purposes
const __dirname = path.dirname(fileURLToPath(import.meta.url));

tsnode.register({
  ignore: [],
  project: process.env.TS_NODE_PROJECT || path.resolve(__dirname,  'tsconfig.json')
});

import "./build/index.mjs";