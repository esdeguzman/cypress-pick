'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { applyPick } = require('../runner');

test('with no picker variables the arguments come back untouched', () => {
    const args = ['cypress', 'run'];
    assert.deepEqual(applyPick(args, {}), args);
});

test('it adds the spec list', () => {
    const out = applyPick(['cypress', 'run'], { CYPICK_SPEC: 'a.cy.js,b.cy.js' });
    assert.deepEqual(out, ['cypress', 'run', '--spec', 'a.cy.js,b.cy.js']);
});

test('it adds the filter on the flag it was told to use', () => {
    const out = applyPick(['cypress', 'run'], {
        CYPICK_SPEC: 'a.cy.js',
        CYPICK_FILTER: 'eyJhIjoxfQ',
        CYPICK_FLAG: '--expose',
    });
    assert.deepEqual(out.slice(2), ['--spec', 'a.cy.js', '--expose', 'cypressPick=eyJhIjoxfQ']);
});

test('it uses the env flag when told to', () => {
    const out = applyPick(['cypress', 'run'], {
        CYPICK_SPEC: 'a.cy.js',
        CYPICK_FILTER: 'eyJhIjoxfQ',
        CYPICK_FLAG: '--env',
    });
    assert.equal(out[4], '--env');
});

test('a spec flag already on the command line wins', () => {
    // The person typed a spec on the command line, so that is what they meant.
    const out = applyPick(['cypress', 'run', '--spec', 'typed.cy.js'], { CYPICK_SPEC: 'picked.cy.js' });
    assert.deepEqual(out, ['cypress', 'run', '--spec', 'typed.cy.js']);
});

test('the short form of a typed spec flag wins too', () => {
    const out = applyPick(['cypress', 'run', '-s', 'typed.cy.js'], { CYPICK_SPEC: 'picked.cy.js' });
    assert.deepEqual(out, ['cypress', 'run', '-s', 'typed.cy.js']);
});

test('a typed spec flag with an equals sign wins too', () => {
    const out = applyPick(['cypress', 'run', '--spec=typed.cy.js'], { CYPICK_SPEC: 'picked.cy.js' });
    assert.deepEqual(out, ['cypress', 'run', '--spec=typed.cy.js']);
});

test('it does not change the array it was given', () => {
    const args = ['cypress', 'run'];
    applyPick(args, { CYPICK_SPEC: 'a.cy.js' });
    assert.deepEqual(args, ['cypress', 'run']);
});
