'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readHost, findSpecs, isSupportInstalled } = require('../src/host-config');

function makeProject(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cypick-'));
    for (const [name, content] of Object.entries(files)) {
        const full = path.join(dir, name);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
    }
    return dir;
}

test('it reads specPattern out of a CommonJS config', () => {
    const dir = makeProject({
        'cypress.config.js': "module.exports = { e2e: { specPattern: 'tests/**/*.spec.js' } }",
    });
    const host = readHost(dir);
    assert.deepEqual(host.specPattern, ['tests/**/*.spec.js']);
    assert.equal(host.configRead, true);
});

test('it falls back to the Cypress defaults when there is no config it can read', () => {
    // A TypeScript config is the wrong fixture for this path: Node 22.6 and later can
    // load one, so whether it fails depends on which Node the suite runs on, not on
    // this code. A config whose top level throws cannot be loaded by any Node version,
    // so this is what actually forces the fallback.
    const dir = makeProject({ 'cypress.config.js': "throw new Error('deliberate failure for this test')" });
    const host = readHost(dir);
    assert.deepEqual(host.specPattern, ['cypress/e2e/**/*.cy.{js,jsx,ts,tsx}']);
    assert.equal(host.supportFile, 'cypress/support/e2e.js');
    assert.equal(host.configRead, false);
});

test('a TypeScript config is read on a Node version that supports it, and falls back on one that does not, and either way the result is usable', () => {
    // Node 22.6 and later strip the types and load a TypeScript config like any other.
    // An earlier Node cannot load it at all. Both are legitimate outcomes, so this test
    // asserts only what holds either way, not which branch was taken.
    const dir = makeProject({ 'cypress.config.ts': 'export default {}' });
    const host = readHost(dir);
    assert.equal(Array.isArray(host.specPattern), true);
    assert.equal(host.specPattern.length > 0, true);
    assert.equal(host.specPattern.every((p) => typeof p === 'string'), true);
    assert.equal(typeof host.supportFile === 'string' || host.supportFile === null, true);
});

test('it finds spec files and returns them with forward slashes', () => {
    const dir = makeProject({
        'cypress.config.js': 'module.exports = { e2e: {} }',
        'cypress/e2e/b.cy.js': 'describe("b", () => {})',
        'cypress/e2e/nested/a.cy.js': 'describe("a", () => {})',
        'cypress/e2e/notaspec.js': '',
    });
    assert.deepEqual(findSpecs(dir, readHost(dir)), [
        'cypress/e2e/b.cy.js',
        'cypress/e2e/nested/a.cy.js',
    ]);
});

test('it honours excludeSpecPattern', () => {
    const dir = makeProject({
        'cypress.config.js': "module.exports = { e2e: { excludeSpecPattern: '**/skip-me.cy.js' } }",
        'cypress/e2e/a.cy.js': '',
        'cypress/e2e/skip-me.cy.js': '',
    });
    assert.deepEqual(findSpecs(dir, readHost(dir)), ['cypress/e2e/a.cy.js']);
});

test('it reports whether the support file imports this package', () => {
    const without = makeProject({
        'cypress.config.js': 'module.exports = { e2e: {} }',
        'cypress/support/e2e.js': "import './commands'",
    });
    assert.equal(isSupportInstalled(without, readHost(without)), false);

    const with_ = makeProject({
        'cypress.config.js': 'module.exports = { e2e: {} }',
        'cypress/support/e2e.js': "import './commands'\nimport 'cypress-pick/support'",
    });
    assert.equal(isSupportInstalled(with_, readHost(with_)), true);
});

test('it reports the host Cypress major version, or null when there is none', () => {
    const dir = makeProject({
        'cypress.config.js': 'module.exports = { e2e: {} }',
        'node_modules/cypress/package.json': '{"name":"cypress","version":"16.1.0"}',
    });
    assert.equal(readHost(dir).cypressMajor, 16);
    assert.equal(readHost(makeProject({})).cypressMajor, null);
});
