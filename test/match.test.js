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
