'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readHost, findSpecs, isSupportInstalled } = require('../src/host-config');
const { resolveCypressBin } = require('../src/run');

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

// Finding I5. The version was read straight out of <project>/node_modules while the
// run was launched with Node's own lookup, which also searches the folders above.
// In a workspace the two disagreed: no version was found, 16 was assumed, and a
// Cypress 15 project was handed a flag it does not understand.

test('I5: the version is found when Cypress is installed in a folder above the project', () => {
    const root = makeProject({
        'node_modules/cypress/package.json': '{"name":"cypress","version":"15.4.0"}',
        'packages/app/cypress.config.js': 'module.exports = { e2e: {} }',
    });
    assert.equal(readHost(path.join(root, 'packages', 'app')).cypressMajor, 15);
});

test('I5: the version reader and the run launcher look in the same place', () => {
    const root = makeProject({
        'node_modules/cypress/package.json': '{"name":"cypress","version":"15.4.0","bin":{"cypress":"bin/cypress"}}',
        'node_modules/cypress/bin/cypress': '',
        'packages/app/cypress.config.js': 'module.exports = { e2e: {} }',
    });
    const app = path.join(root, 'packages', 'app');
    assert.equal(readHost(app).cypressMajor, 15);
    assert.equal(typeof resolveCypressBin(app), 'string');
});

// Finding I9. A commented-out import is not an import. Reading it as one makes the
// contexts tickable and sends a filter that nothing in the browser applies.

test('I9: an import that appears only inside a comment does not count', () => {
    const lineComment = makeProject({
        'cypress.config.js': 'module.exports = { e2e: {} }',
        'cypress/support/e2e.js': "// import 'cypress-pick/support'\nimport './commands'",
    });
    assert.equal(isSupportInstalled(lineComment, readHost(lineComment)), false);

    const blockComment = makeProject({
        'cypress.config.js': 'module.exports = { e2e: {} }',
        'cypress/support/e2e.js': "/*\n  import 'cypress-pick/support'\n*/\nimport './commands'",
    });
    assert.equal(isSupportInstalled(blockComment, readHost(blockComment)), false);
});

test('I9: a real import is still found when a comment mentions one too', () => {
    const dir = makeProject({
        'cypress.config.js': 'module.exports = { e2e: {} }',
        'cypress/support/e2e.js': "// add import 'cypress-pick/support' below\nimport 'cypress-pick/support'",
    });
    assert.equal(isSupportInstalled(dir, readHost(dir)), true);
});

test('I9: a double slash inside a string is not read as the start of a comment', () => {
    const dir = makeProject({
        'cypress.config.js': 'module.exports = { e2e: {} }',
        'cypress/support/e2e.js': "const site = 'https://example.com'\nimport 'cypress-pick/support'",
    });
    assert.equal(isSupportInstalled(dir, readHost(dir)), true);
});
