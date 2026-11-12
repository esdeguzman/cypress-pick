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
    assert.deepEqual(picked[0].suites[0], {
        path: ['Root', 'A one'], checked: true, selectable: true, runsAnyway: false,
    });
    assert.equal(picked[0].suites[2].selectable, false);
    // A skipped context does not run whether the spec is filtered or sent whole, so
    // it does not stop the spec counting as ticked whole.
    assert.equal(picked[0].suites[2].runsAnyway, false);
});

test('a context whose title could not be read cannot be ticked', () => {
    const scanned = [{
        relative: 'c.cy.js',
        tests: 1,
        suites: [{ title: null, path: ['Root', ''], depth: 1, tests: 1, modifier: null, readable: false, blockedBy: null }],
    }];
    let state = reduce(createState(scanned), 'open');
    const row = visibleRows(state)[1];
    assert.equal(row.selectable, false);
    assert.equal(row.note, 'title cannot be read');
});

// Finding C2. A context under one that cannot be ticked cannot be ticked either,
// because its own title path carries the gap and can never be matched.

test('C2: a context inside an unreadable one cannot be ticked', () => {
    const scanned = [{
        relative: 'c.cy.js',
        tests: 1,
        suites: [
            { title: null, path: ['Root', ''], depth: 1, tests: 1, modifier: null, readable: false, blockedBy: null },
            { title: 'inner', path: ['Root', '', 'inner'], depth: 2, tests: 1, modifier: null, readable: true, blockedBy: 'unreadable' },
        ],
    }];
    const state = reduce(createState(scanned), 'open');
    const row = visibleRows(state)[2];
    assert.equal(row.selectable, false);
    assert.equal(row.note, 'inside a context whose title cannot be read');
});

test('C2: a context inside a skipped one cannot be ticked', () => {
    const scanned = [{
        relative: 'c.cy.js',
        tests: 1,
        suites: [
            { title: 'outer', path: ['Root', 'outer'], depth: 1, tests: 1, modifier: 'skip', readable: true, blockedBy: null },
            { title: 'inner', path: ['Root', 'outer', 'inner'], depth: 2, tests: 1, modifier: null, readable: true, blockedBy: 'skip' },
        ],
    }];
    const state = reduce(createState(scanned), 'open');
    assert.equal(visibleRows(state)[2].selectable, false);
    assert.equal(visibleRows(state)[2].note, 'inside a skipped context');
});

// Finding I1. The two markers people actually leave behind must both be warned
// about: one on the outermost suite, and one on a single test.

test('I1: an only on the outermost suite is warned about', () => {
    const scanned = [{
        relative: 'a.cy.js',
        tests: 4,
        onlySuites: [{ title: 'Root', tests: 4 }],
        onlyTests: 0,
        suites: [],
    }];
    const state = reduce(createState(scanned), 'all');
    assert.equal(warnings(state).length, 1);
    assert.match(warnings(state)[0], /'Root'/);
});

test('I1: an only on a test is warned about', () => {
    const scanned = [{ relative: 'a.cy.js', tests: 4, onlySuites: [], onlyTests: 2, suites: [] }];
    const state = reduce(createState(scanned), 'all');
    assert.equal(warnings(state).length, 1);
    assert.match(warnings(state)[0], /2 tests/);
});

test('I1: a spec row shows the only note even when the marker is on the outermost suite', () => {
    const scanned = [{ relative: 'a.cy.js', tests: 4, onlySuites: [{ title: 'Root', tests: 4 }], onlyTests: 0, suites: [] }];
    assert.equal(visibleRows(createState(scanned))[0].note, 'only');
});

// Finding C1. A spec carrying only is not narrowed, so the warning says so.

const ONLY_SPEC = () => [{
    relative: 'a.cy.js',
    tests: 3,
    onlySuites: [{ title: 'Sprint 4', tests: 2 }],
    onlyTests: 0,
    suites: [
        { title: 'G', path: ['Root', 'G'], depth: 1, tests: 1, modifier: null, readable: true, blockedBy: null },
        { title: 'Sprint 4', path: ['Root', 'Sprint 4'], depth: 1, tests: 2, modifier: 'only', readable: true, blockedBy: null },
    ],
}];

test('C1: a partly ticked spec carrying only is told its ticks were not applied', () => {
    let state = reduce(createState(ONLY_SPEC()), 'open');
    state = reduce(reduce(state, 'down'), 'toggle');
    const lines = warnings(state);
    assert.equal(lines.length, 2);
    assert.match(lines[1], /were not applied/);
});

test('C1: a spec carrying only that is ticked whole gets one line, not two', () => {
    assert.equal(warnings(reduce(createState(ONLY_SPEC()), 'all')).length, 1);
});

test('toPickedSpecs says whether a spec carries only, so the filter can be left off', () => {
    const scanned = [{ relative: 'a.cy.js', tests: 1, onlySuites: [], onlyTests: 1, suites: [] }];
    assert.equal(toPickedSpecs(reduce(createState(scanned), 'all'))[0].hasOnly, true);
});

// Finding I4. A spec with nothing to tick says so when it is opened, rather than
// opening onto nothing.

test('I4: opening a spec with no contexts shows a line saying there are none', () => {
    const scanned = [{ relative: 'a.cy.js', tests: 1, suites: [] }];
    const rows = visibleRows(reduce(createState(scanned), 'open'));
    assert.equal(rows.length, 2);
    assert.equal(rows[1].kind, 'note');
    assert.equal(rows[1].selectable, false);
});
