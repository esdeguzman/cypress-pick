'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildSelection, buildArgs, buildEnv } = require('../src/build-args');
const { decode } = require('../src/filter-codec');

const spec = (relative, checked, suites) => ({ relative, checked, suites });
const suite = (path, checked, selectable = true) => ({ path, checked, selectable });

test('a spec with everything ticked contributes no filter', () => {
    const sel = buildSelection([
        spec('cypress/e2e/a.cy.js', true, [
            suite(['Root', 'A'], true),
            suite(['Root', 'B'], true),
        ]),
    ]);
    assert.deepEqual(sel.specs, ['cypress/e2e/a.cy.js']);
    assert.deepEqual(sel.filter, {});
});

test('a spec with no suites at all contributes no filter', () => {
    const sel = buildSelection([spec('cypress/e2e/a.cy.js', true, [])]);
    assert.deepEqual(sel.specs, ['cypress/e2e/a.cy.js']);
    assert.deepEqual(sel.filter, {});
});

test('a spec with some suites ticked contributes those paths', () => {
    const sel = buildSelection([
        spec('cypress/e2e/a.cy.js', true, [
            suite(['Root', 'A'], true),
            suite(['Root', 'B'], false),
        ]),
    ]);
    assert.deepEqual(sel.filter, { 'cypress/e2e/a.cy.js': [['Root', 'A']] });
});

test('a suite that cannot be ticked is left out of the all-ticked test', () => {
    // A skipped context can never be ticked, so a spec whose only unticked suite is
    // a skipped one still counts as ticked whole.
    const sel = buildSelection([
        spec('cypress/e2e/a.cy.js', true, [
            suite(['Root', 'A'], true),
            suite(['Root', 'Skipped'], false, false),
        ]),
    ]);
    assert.deepEqual(sel.filter, {});
});

test('an unticked spec is left out entirely', () => {
    const sel = buildSelection([
        spec('cypress/e2e/a.cy.js', true, [suite(['Root', 'A'], true)]),
        spec('cypress/e2e/b.cy.js', false, [suite(['Root', 'A'], false)]),
    ]);
    assert.deepEqual(sel.specs, ['cypress/e2e/a.cy.js']);
});

test('Cypress 16 and above gets the expose flag', () => {
    const sel = buildSelection([
        spec('a.cy.js', true, [suite(['Root', 'A'], true), suite(['Root', 'B'], false)]),
    ]);
    const args = buildArgs(sel, { cypressMajor: 16 });
    assert.deepEqual(args.slice(0, 2), ['--spec', 'a.cy.js']);
    assert.equal(args[2], '--expose');
    assert.equal(args[3].startsWith('cypressPick='), true);
    assert.deepEqual(decode(args[3].slice('cypressPick='.length)), sel.filter);
});

test('below Cypress 16 gets the env flag instead', () => {
    const sel = buildSelection([
        spec('a.cy.js', true, [suite(['Root', 'A'], true), suite(['Root', 'B'], false)]),
    ]);
    assert.equal(buildArgs(sel, { cypressMajor: 15 })[2], '--env');
});

test('no filter means no flag at all, only the spec list', () => {
    const sel = buildSelection([spec('a.cy.js', true, [suite(['Root', 'A'], true)])]);
    assert.deepEqual(buildArgs(sel, { cypressMajor: 16 }), ['--spec', 'a.cy.js']);
});

test('several specs are joined with commas', () => {
    const sel = buildSelection([
        spec('a.cy.js', true, []),
        spec('b.cy.js', true, []),
    ]);
    assert.deepEqual(buildArgs(sel, { cypressMajor: 16 }), ['--spec', 'a.cy.js,b.cy.js']);
});

test('the environment variables carry the same values', () => {
    const sel = buildSelection([
        spec('a.cy.js', true, [suite(['Root', 'A'], true), suite(['Root', 'B'], false)]),
    ]);
    const env = buildEnv(sel, { cypressMajor: 16 });
    assert.equal(env.CYPICK_SPEC, 'a.cy.js');
    assert.equal(env.CYPICK_FLAG, '--expose');
    assert.deepEqual(decode(env.CYPICK_FILTER), sel.filter);
});

test('the environment variables omit the filter when there is none', () => {
    const env = buildEnv(buildSelection([spec('a.cy.js', true, [])]), { cypressMajor: 16 });
    assert.equal(env.CYPICK_SPEC, 'a.cy.js');
    assert.equal('CYPICK_FILTER' in env, false);
});
