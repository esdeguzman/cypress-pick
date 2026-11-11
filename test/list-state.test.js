'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createState, visibleRows, reduce, toPickedSpecs, warnings } = require('../src/list-state');

const SCANNED = [
    {
        relative: 'cypress/e2e/a.cy.js',
        tests: 6,
        suites: [
            { title: 'A one', path: ['Root', 'A one'], depth: 1, tests: 2, modifier: null, readable: true },
            { title: 'A two', path: ['Root', 'A two'], depth: 1, tests: 3, modifier: null, readable: true },
            { title: 'A skipped', path: ['Root', 'A skipped'], depth: 1, tests: 1, modifier: 'skip', readable: true },
        ],
    },
    {
        relative: 'cypress/e2e/b.cy.js',
        tests: 4,
        suites: [
            { title: 'B one', path: ['Root', 'B one'], depth: 1, tests: 4, modifier: 'only', readable: true },
        ],
    },
];

const marks = (state) => visibleRows(state).map((r) => r.kind + ':' + r.mark + ':' + r.label);

test('it starts with nothing ticked, nothing open, and the cursor at the top', () => {
    const state = createState(SCANNED);
    assert.equal(state.cursor, 0);
    assert.deepEqual(visibleRows(state).map((r) => r.kind), ['spec', 'spec']);
    assert.equal(visibleRows(state)[0].mark, ' ');
});

test('opening a spec shows its contexts, closing hides them again', () => {
    let state = reduce(createState(SCANNED), 'open');
    assert.deepEqual(visibleRows(state).map((r) => r.kind), ['spec', 'suite', 'suite', 'suite', 'spec']);
    state = reduce(state, 'close');
    assert.deepEqual(visibleRows(state).map((r) => r.kind), ['spec', 'spec']);
});

test('ticking a spec ticks all of its selectable contexts but not a skipped one', () => {
    let state = reduce(createState(SCANNED), 'toggle');
    state = reduce(state, 'open');
    assert.deepEqual(marks(state), [
        'spec:x:cypress/e2e/a.cy.js',
        'suite:x:A one',
        'suite:x:A two',
        'suite: :A skipped',
        'spec: :cypress/e2e/b.cy.js',
    ]);
});

test('unticking one context makes the spec partial', () => {
    let state = reduce(createState(SCANNED), 'toggle');
    state = reduce(state, 'open');
    state = reduce(state, 'down');
    state = reduce(state, 'toggle');
    assert.equal(visibleRows(state)[0].mark, '~');
});

test('unticking every context unticks the spec', () => {
    let state = reduce(createState(SCANNED), 'toggle');
    state = reduce(state, 'open');
    state = reduce(reduce(state, 'down'), 'toggle');
    state = reduce(reduce(state, 'down'), 'toggle');
    assert.equal(visibleRows(state)[0].mark, ' ');
    assert.deepEqual(toPickedSpecs(state).filter((s) => s.checked), []);
});

test('ticking a context ticks its spec', () => {
    let state = reduce(createState(SCANNED), 'open');
    state = reduce(reduce(state, 'down'), 'toggle');
    assert.equal(visibleRows(state)[0].mark, '~');
});

test('a skipped context cannot be ticked', () => {
    let state = reduce(createState(SCANNED), 'open');
    state = reduce(reduce(reduce(state, 'down'), 'down'), 'down');
    const before = visibleRows(state)[3].mark;
    state = reduce(state, 'toggle');
    assert.equal(visibleRows(state)[3].mark, before);
    assert.equal(visibleRows(state)[3].note, 'skipped');
});

test('the cursor stops at both ends rather than wrapping', () => {
    let state = createState(SCANNED);
    state = reduce(state, 'up');
    assert.equal(state.cursor, 0);
    state = reduce(reduce(reduce(state, 'down'), 'down'), 'down');
    assert.equal(state.cursor, 1);
});

test('all ticks every spec and none unticks them', () => {
    let state = reduce(createState(SCANNED), 'all');
    assert.deepEqual(visibleRows(state).map((r) => r.mark), ['x', 'x']);
    state = reduce(state, 'none');
    assert.deepEqual(visibleRows(state).map((r) => r.mark), [' ', ' ']);
});

test('a ticked spec carrying only is warned about, an unticked one is not', () => {
    let state = createState(SCANNED);
    assert.deepEqual(warnings(state), []);
    state = reduce(state, 'all');
    assert.equal(warnings(state).length, 1);
    assert.match(warnings(state)[0], /b\.cy\.js/);
    assert.match(warnings(state)[0], /only/);
});

test('toPickedSpecs gives build-args what it expects', () => {
    let state = reduce(createState(SCANNED), 'toggle');
    const picked = toPickedSpecs(state);
    assert.equal(picked[0].relative, 'cypress/e2e/a.cy.js');
    assert.equal(picked[0].checked, true);
    assert.deepEqual(picked[0].suites[0], { path: ['Root', 'A one'], checked: true, selectable: true });
    assert.equal(picked[0].suites[2].selectable, false);
});

test('a context whose title could not be read cannot be ticked', () => {
    const scanned = [{
        relative: 'c.cy.js',
        tests: 1,
        suites: [{ title: null, path: ['Root', ''], depth: 1, tests: 1, modifier: null, readable: false }],
    }];
    let state = reduce(createState(scanned), 'open');
    const row = visibleRows(state)[1];
    assert.equal(row.selectable, false);
    assert.equal(row.note, 'title cannot be read');
});
