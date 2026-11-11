#!/usr/bin/env node
'use strict';

const { main } = require('../src/cli');

main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
        process.stdout.write('\n  cypress-pick stopped: ' + err.message + '\n\n');
        process.exitCode = 1;
    });
