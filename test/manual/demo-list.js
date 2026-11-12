'use strict';

// Run this by hand to check the list draws and responds. It runs against the real
// spec files of whatever project path is given, and it never starts Cypress.
//
//   node test/manual/demo-list.js C:/Users/User/Documents/code/konjuur-cypress

const path = require('node:path');
const fs = require('node:fs');
const { scanFile } = require('../../src/spec-scan');
const { createState, toPickedSpecs, warnings } = require('../../src/list-state');
const { promptList } = require('../../src/checkbox-list');
const { buildSelection, buildArgs } = require('../../src/build-args');

const project = process.argv[2];
const dir = path.join(project, 'cypress', 'e2e', 'konjuur');

const scanned = fs.readdirSync(dir).filter((f) => f.endsWith('.cy.js')).map((f) => {
    const result = scanFile(path.join(dir, f));
    return {
        relative: 'cypress/e2e/konjuur/' + f,
        tests: result.tests,
        suites: result.suites.filter((s) => s.depth >= 1),
    };
});

promptList(createState(scanned), { title: 'demo, nothing will run' }).then((picked) => {
    if (!picked) {
        console.log('quit');
        return;
    }
    const state = picked.state;
    console.log('');
    for (const line of warnings(state)) console.log('  ' + line);
    console.log('  args:', buildArgs(buildSelection(toPickedSpecs(state)), { cypressMajor: 16 }).join(' '));
});
