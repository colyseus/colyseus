#!/usr/bin/env node
const minimist = require("minimist");
const argv = minimist(process.argv.slice(2));

console.warn("DEPRECATED: @colyseus/loadtest usage has changed. Please check the documentation: https://docs.colyseus.io/colyseus/tools/loadtest/#usage")

if (argv._[0]) {
    console.log("")
    console.log("Usage:");
    console.log("\tnode " + argv._[0]);
    console.log("")
}

process.exit();