'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveCypressBin, buildCypressSpawnPlan, runNpmScript } = require('../src/run');

function makeProject(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cypick-run-'));
    for (const [name, content] of Object.entries(files)) {
        const full = path.join(dir, name);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
    }
    return dir;
}

// Stands in for a host project that has cypress installed, with the same shape its
// real package.json carries: a "bin" entry naming the command script.
function makeFakeCypressProject() {
    return makeProject({
        'node_modules/cypress/package.json': JSON.stringify({ name: 'cypress', bin: { cypress: 'bin/cypress' } }),
        'node_modules/cypress/bin/cypress': '#!/usr/bin/env node\n',
    });
}

test('with no cypress installed in the host project, nothing is resolved', () => {
    // This repository is the host directory here, and it does not depend on cypress
    // itself, so this is a real negative case rather than a stand-in for one.
    assert.equal(resolveCypressBin(process.cwd()), null);
});

test('it resolves the command script out of the host project\'s own install', () => {
    const dir = makeFakeCypressProject();
    const entry = resolveCypressBin(dir);
    assert.equal(entry, path.join(dir, 'node_modules', 'cypress', 'bin', 'cypress'));
});

test('with no cypress installed, there is no spawn plan at all', () => {
    const dir = makeProject({});
    assert.equal(buildCypressSpawnPlan(dir, ['--spec', 'a.cy.js']), null);
});

test('a spec path containing a space stays a single argument', () => {
    const dir = makeFakeCypressProject();
    const plan = buildCypressSpawnPlan(dir, ['--spec', 'cypress/e2e/my spec.cy.js']);
    assert.equal(plan.command, process.execPath);
    assert.deepEqual(plan.args.slice(1), ['run', '--spec', 'cypress/e2e/my spec.cy.js']);
});

test('a spec path containing & is never interpreted, because there is no shell', () => {
    const dir = makeFakeCypressProject();
    const plan = buildCypressSpawnPlan(dir, ['--spec', 'cypress/e2e/a & b.cy.js']);
    assert.deepEqual(plan.args.slice(1), ['run', '--spec', 'cypress/e2e/a & b.cy.js']);
});

test('the plan never puts the arguments in a shell string', () => {
    // The whole point of the fix: Node spawns the array as given, with no shell in
    // between, so there is nothing that re-splits a value on a space or treats a
    // character such as & as the start of a second command.
    const dir = makeFakeCypressProject();
    const plan = buildCypressSpawnPlan(dir, ['--spec', 'a & b.cy.js']);
    assert.equal(Array.isArray(plan.args), true);
    assert.equal(plan.args.includes('run & a & b.cy.js'), false);
});

test('runNpmScript refuses a name that is not one of the scripts it was given', () => {
    // No spawnSync call happens on this path, so this does not start anything.
    const result = runNpmScript('not-a-real-script', {
        cwd: process.cwd(),
        env: {},
        scripts: ['test', 'build'],
    });
    assert.equal(result, 1);
});

test('runNpmScript accepts a name that is one of the scripts it was given', () => {
    // Uses a script that only prints its own name, so nothing else starts.
    const dir = makeProject({
        'package.json': JSON.stringify({
            name: 'fake-host',
            scripts: { echo: process.platform === 'win32' ? 'echo hi' : 'echo hi' },
        }),
    });
    const result = runNpmScript('echo', { cwd: dir, env: {}, scripts: ['echo'] });
    assert.equal(result, 0);
});
