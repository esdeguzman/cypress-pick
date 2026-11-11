'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { runnableScripts } = require('../src/npm-scripts');

// Taken from konjuur-cypress, because it is the shape this has to handle: a chain
// of scripts where the one that starts Cypress is three steps in.
const KONJUUR = {
    scripts: {
        test: 'npx cypress open',
        headless: 'node scripts/run-cypress.js',
        'headless:evidence': 'cross-env ALWAYS_VIDEO=true node scripts/run-cypress.js',
        'report:clean': 'rimraf cypress/results cypress/reports/.work',
        'report:merge': 'mochawesome-merge cypress/results/*.json -o cypress/results/mochawesome.json',
        'report:pdf': 'node scripts/generate-report.js',
        report: 'npm run report:merge && npm run report:pdf',
        'test:report': 'npm run report:clean && npm run headless && npm run report',
        'test:evidence': 'npm run report:clean && npm run headless:evidence && npm run report',
    },
};

test('it leaves out a script that opens the Cypress window', () => {
    const names = runnableScripts(KONJUUR).map((s) => s.name);
    assert.equal(names.includes('test'), false);
});

test('it leaves out a script that opens the window further down a chain', () => {
    const names = runnableScripts({ scripts: { open: 'npx cypress open', both: 'npm run open && npm run x', x: 'echo' } }).map((s) => s.name);
    assert.equal(names.includes('both'), false);
});

test('it keeps the headless and report scripts', () => {
    const names = runnableScripts(KONJUUR).map((s) => s.name);
    for (const expected of ['headless', 'headless:evidence', 'test:report', 'test:evidence']) {
        assert.equal(names.includes(expected), true, expected + ' should be offered');
    }
});

test('it returns an empty list when there are no scripts', () => {
    assert.deepEqual(runnableScripts({}), []);
    assert.deepEqual(runnableScripts({ scripts: {} }), []);
});

test('a chain that refers to itself does not hang', () => {
    const names = runnableScripts({ scripts: { a: 'npm run b', b: 'npm run a' } }).map((s) => s.name);
    assert.deepEqual(names.sort(), ['a', 'b']);
});
