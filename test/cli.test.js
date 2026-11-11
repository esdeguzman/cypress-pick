'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { composeCypressArgs, decideHow } = require('../src/cli');

// Finding 2: a typed --spec must win over the picked one, the same rule
// runner.js already applies to the other run path. buildArgs always puts the
// picked spec as its first two entries, ['--spec', value], so dropping them is
// what "the typed one wins" means here.

test('with no typed spec flag, the picked one is kept', () => {
    const selection = { specs: ['picked.cy.js'], filter: {} };
    const args = composeCypressArgs(selection, { cypressMajor: 16 }, ['--browser', 'chrome']);
    assert.deepEqual(args, ['--spec', 'picked.cy.js', '--browser', 'chrome']);
});

test('a typed --spec replaces the picked one instead of sitting beside it', () => {
    const selection = { specs: ['picked.cy.js'], filter: {} };
    const args = composeCypressArgs(selection, { cypressMajor: 16 }, ['--spec', 'typed.cy.js']);
    assert.deepEqual(args, ['--spec', 'typed.cy.js']);
});

test('a typed -s replaces the picked spec too', () => {
    const selection = { specs: ['picked.cy.js'], filter: {} };
    const args = composeCypressArgs(selection, { cypressMajor: 16 }, ['-s', 'typed.cy.js']);
    assert.deepEqual(args, ['-s', 'typed.cy.js']);
});

test('a typed --spec=value replaces the picked spec too', () => {
    const selection = { specs: ['picked.cy.js'], filter: {} };
    const args = composeCypressArgs(selection, { cypressMajor: 16 }, ['--spec=typed.cy.js']);
    assert.deepEqual(args, ['--spec=typed.cy.js']);
});

test('a typed --spec still keeps the filter flag, dropping only the spec pair', () => {
    // Only the ['--spec', value] pair that buildArgs puts first is dropped. The
    // filter flag behind it is not part of that pair, so it stays, ahead of
    // whatever the person typed.
    const selection = { specs: ['picked.cy.js'], filter: { 'picked.cy.js': [['Root', 'A']] } };
    const args = composeCypressArgs(selection, { cypressMajor: 16 }, ['--spec', 'typed.cy.js']);
    assert.equal(args[0], '--expose');
    assert.equal(args[1].startsWith('cypressPick='), true);
    assert.deepEqual(args.slice(2), ['--spec', 'typed.cy.js']);
});

// Finding 3: ticking more than one run mode must refuse to run at all and say so,
// instead of picking the first ticked row without telling the person. Ticking none
// must say so too, rather than behaving exactly like a deliberate choice of "run
// cypress directly".

const scriptRow = (name) => ({ name });
const specRow = (checked) => ({ checked });

test('ticking exactly the cypress row runs cypress, with no message', () => {
    const state = { specs: [specRow(true), specRow(false)] };
    const outcome = decideHow(state, [scriptRow('headless')]);
    assert.deepEqual(outcome.how, { kind: 'cypress' });
    assert.equal(outcome.message, null);
});

test('ticking exactly one script row runs that script', () => {
    const state = { specs: [specRow(false), specRow(true)] };
    const outcome = decideHow(state, [scriptRow('headless')]);
    assert.deepEqual(outcome.how, { kind: 'script', name: 'headless' });
    assert.equal(outcome.message, null);
});

test('ticking nothing runs cypress, but says so instead of behaving the same as choosing it', () => {
    const state = { specs: [specRow(false), specRow(false)] };
    const outcome = decideHow(state, [scriptRow('headless')]);
    assert.deepEqual(outcome.how, { kind: 'cypress' });
    assert.equal(typeof outcome.message, 'string');
    assert.equal(outcome.message.length > 0, true);
});

test('ticking more than one row refuses instead of guessing which one was meant', () => {
    const state = { specs: [specRow(true), specRow(true)] };
    const outcome = decideHow(state, [scriptRow('headless')]);
    assert.equal(outcome.how, null);
    assert.equal(typeof outcome.message, 'string');
    assert.equal(outcome.message.length > 0, true);
});
