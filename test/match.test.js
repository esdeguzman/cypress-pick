'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isPrefix, shouldRegisterSuite, shouldRegisterTest } = require('../src/match');

const SELECTED = [['Projects', 'Pagination']];

test('isPrefix is true when every title matches in order', () => {
    assert.equal(isPrefix(['Projects'], ['Projects', 'Pagination']), true);
    assert.equal(isPrefix(['Projects', 'Pagination'], ['Projects', 'Pagination']), true);
});

test('isPrefix is false when a title differs or the shorter list is longer', () => {
    assert.equal(isPrefix(['Projects', 'Search'], ['Projects', 'Pagination']), false);
    assert.equal(isPrefix(['Projects', 'Pagination', 'Deep'], ['Projects', 'Pagination']), false);
});

test('the outermost suite registers, because a ticked context lives inside it', () => {
    assert.equal(shouldRegisterSuite(['Projects'], SELECTED), true);
});

test('a ticked context registers', () => {
    assert.equal(shouldRegisterSuite(['Projects', 'Pagination'], SELECTED), true);
});

test('a context nested inside a ticked one registers', () => {
    assert.equal(shouldRegisterSuite(['Projects', 'Pagination', 'Multi-page navigation'], SELECTED), true);
});

test('an unticked sibling does not register', () => {
    assert.equal(shouldRegisterSuite(['Projects', 'Search'], SELECTED), false);
});

test('a test inside a ticked context registers', () => {
    assert.equal(shouldRegisterTest(['Projects', 'Pagination'], SELECTED), true);
});

test('a test nested deeper inside a ticked context registers', () => {
    assert.equal(shouldRegisterTest(['Projects', 'Pagination', 'Multi-page navigation'], SELECTED), true);
});

test('a test sitting directly in the outermost suite does not register', () => {
    // The outermost suite has to register so its ticked children can run. Without
    // this rule its own loose tests would run too, which is not what was ticked.
    assert.equal(shouldRegisterTest(['Projects'], SELECTED), false);
});

test('a test in an unticked sibling does not register', () => {
    assert.equal(shouldRegisterTest(['Projects', 'Search'], SELECTED), false);
});

test('an empty selection registers everything', () => {
    assert.equal(shouldRegisterSuite(['Projects', 'Search'], []), true);
    assert.equal(shouldRegisterTest(['Projects'], []), true);
});

test('two ticked contexts both register and their siblings do not', () => {
    const two = [['Root', 'A'], ['Root', 'C']];
    assert.equal(shouldRegisterSuite(['Root', 'A'], two), true);
    assert.equal(shouldRegisterSuite(['Root', 'C'], two), true);
    assert.equal(shouldRegisterSuite(['Root', 'B'], two), false);
});

// Finding C3. Being inside something ticked is no longer enough on its own. The
// nearest answer wins: the longest ticked or unticked path that the suite sits
// under is the one that decides.

const PICKED = [['Root', 'A'], ['Root', 'B']];
const DROPPED = [['Root', 'A', 'A child']];

test('C3: a context unticked under a ticked parent does not register', () => {
    assert.equal(shouldRegisterSuite(['Root', 'A', 'A child'], PICKED, DROPPED), false);
    assert.equal(shouldRegisterTest(['Root', 'A', 'A child'], PICKED, DROPPED), false);
});

test('C3: its ticked parent still registers, and so do the parent\'s own tests', () => {
    assert.equal(shouldRegisterSuite(['Root', 'A'], PICKED, DROPPED), true);
    assert.equal(shouldRegisterTest(['Root', 'A'], PICKED, DROPPED), true);
});

test('C3: a ticked context under an unticked parent still runs', () => {
    // The parent has to register, or its ticked child never gets the chance to.
    // Its own loose tests must not.
    const picked = [['Root', 'A', 'A child']];
    const dropped = [['Root', 'A'], ['Root', 'B']];
    assert.equal(shouldRegisterSuite(['Root', 'A'], picked, dropped), true);
    assert.equal(shouldRegisterTest(['Root', 'A'], picked, dropped), false);
    assert.equal(shouldRegisterSuite(['Root', 'A', 'A child'], picked, dropped), true);
    assert.equal(shouldRegisterTest(['Root', 'A', 'A child'], picked, dropped), true);
    assert.equal(shouldRegisterSuite(['Root', 'B'], picked, dropped), false);
});

test('C3: leaving the unticked list out behaves exactly as before', () => {
    assert.equal(shouldRegisterSuite(['Root', 'A', 'A child'], PICKED), true);
    assert.equal(shouldRegisterTest(['Root', 'A', 'A child'], PICKED), true);
});
