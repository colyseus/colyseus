#!/usr/bin/env node
const path = require('path');

require('ts-node').register({
  ignore: [],
  project: process.env.TS_NODE_PROJECT || path.resolve(__dirname,  'tsconfig.json')
});

require('./build');