'use strict';

// The two halves of this package run the whole way through here: a real fixture
// file is scanned, listed, ticked, turned into a filter, encoded, decoded, and then
// that same file is executed against a stand-in for Mocha. The tests that register
// are compared against the tests that were ticked.
//
// Every other test file feeds one module an input written by hand. That is what let
// three faults through: each half was right on its own and wrong together.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { scanSource, summariseScan } = require('../src/spec-scan');
const { createState, reduce, visibleRows, toPickedSpecs, warnings } = require('../src/list-state');
const { buildSelection } = require('../src/build-args');
const { encode, decode } = require('../src/filter-codec');
const { installFilter, selectedFor } = require('../support/index.js');

// A stand-in for Mocha. Registering a suite runs its callback straight away, which
// is what Mocha does, and is what lets the wrapper track which suite it is inside.
// only is recorded as well as run, because this package must not change what Mocha
// does with it.
function fakeMocha() {
    const registered = { suites: [], tests: [], only: [] };
    const globals = {};

    const suite = (title, ...rest) => {
        registered.suites.push(title);
        const fn = rest[rest.length - 1];
        if (typeof fn === 'function') fn();
    };
    const onlySuite = (title, ...rest) => {
        registered.only.push(title);
        return suite(title, ...rest);
    };
    const testFn = (title) => { registered.tests.push(title); };
    const onlyTest = (title) => { registered.only.push(title); registered.tests.push(title); };

    globals.describe = suite;
    globals.describe.only = onlySuite;
    globals.describe.skip = () => {};
    globals.context = suite;
    globals.context.only = onlySuite;
    globals.context.skip = () => {};
    globals.it = testFn;
    globals.it.only = onlyTest;
    globals.it.skip = () => {};
    globals.specify = testFn;
    globals.specify.only = onlyTest;
    globals.specify.skip = () => {};

    return { registered, globals };
}

function readFixture(name) {
    return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

// Executes the fixture's own source against the stand-in, so the file that was
// scanned is the file that runs.
function runSpecSource(source, globals) {
    const run = new Function('describe', 'context', 'it', 'specify', source);
    run(globals.describe, globals.context, globals.it, globals.specify);
}

// The whole journey for one fixture. `keys` are the keys a person would press.
function pick(name, keys, { runInstead } = {}) {
    const source = readFixture(name);
    const relative = 'cypress/e2e/' + name;
    const scanned = [Object.assign({ relative }, summariseScan(scanSource(source), { listContexts: true }))];

    let state = createState(scanned);
    for (const key of keys) state = reduce(state, key);

    const selection = buildSelection(toPickedSpecs(state));
    // Through the command line and back, exactly as a real run does it. The spec is
    // looked up with backslashes, which is how Cypress reports it on Windows.
    const filter = decode(encode(selection.filter));
    const entry = selectedFor(filter, relative.replace(/\//g, '\\'));

    const { registered, globals } = fakeMocha();
    const installed = installFilter({
        globals,
        selected: entry.include,
        excluded: entry.exclude,
        spec: relative,
        // Hold the "did anything match" check rather than letting it fire on its
        // own. In a browser it runs once the spec file has been read and throws
        // there, which is the point. Here each test calls it when it wants to, so a
        // throw belongs to the test that caused it instead of surfacing later from
        // inside a different one.
        schedule: () => {},
    });
    // With nothing ticked the command refuses to launch, so no spec is executed.
    // Running one here would measure something that never happens.
    if (selection.specs.length > 0) {
        runSpecSource(runInstead ? readFixture(runInstead) : source, globals);
    }

    return { state, rows: visibleRows(state), selection, entry, registered, installed, warnings: warnings(state) };
}

// C3. The list said "some contexts", and every test in the spec ran.

test('C3: a context unticked under a ticked parent does not run', () => {
    // Tick the spec, open it, move to "A child" and untick it.
    const r = pick('nested.cy.js', ['toggle', 'open', 'down', 'down', 'toggle']);
    assert.deepEqual(r.rows.map((x) => x.mark), ['~', 'x', ' ', 'x']);
    assert.deepEqual(r.registered.tests, ['a1', 'b1']);
    assert.equal(r.registered.suites.includes('A child'), false);
});

test('C3: a nested context ticked on its own runs, and its parent\'s own tests do not', () => {
    // Open, move to "A child" and tick only that.
    const r = pick('nested.cy.js', ['open', 'down', 'down', 'toggle']);
    assert.deepEqual(r.registered.tests, ['a2']);
    assert.equal(r.registered.suites.includes('A'), true);
});

test('C3: ticking the whole spec sends no filter and runs everything', () => {
    const r = pick('nested.cy.js', ['toggle']);
    assert.deepEqual(r.selection.filter, {});
    assert.deepEqual(r.registered.tests, ['loose test', 'a1', 'a2', 'b1']);
});

// C1. A narrowed spec that also carries only used to register no tests at all.

test('C1: a spec carrying only is not narrowed, so the warning line is true of the run', () => {
    // Tick only the context that does not carry only.
    const r = pick('carries-only.cy.js', ['open', 'down', 'toggle']);
    assert.deepEqual(r.selection.filter, {});
    assert.deepEqual(r.registered.tests, ['g1', 's1', 's2']);
    assert.deepEqual(r.registered.only, ['Sprint 4']);
    assert.equal(r.warnings.length, 2);
    assert.match(r.warnings[0], /2 of its 3 tests/);
    assert.match(r.warnings[1], /were not applied/);
});

test('C1: when a filter does reach a spec carrying only, the tests inside it still register', () => {
    // This is the state the reviewer reproduced: a filter and an only in the same
    // file. It happens when the spec changed after it was picked. The only suite
    // and everything in it must register, so that Mocha is the one that decides.
    const source = readFixture('carries-only.cy.js');
    const { registered, globals } = fakeMocha();
    installFilter({
        globals,
        selected: [['Confirmed bugs', 'G. Sprint 3 guard']],
        excluded: [['Confirmed bugs', 'Sprint 4']],
        spec: 'cypress/e2e/carries-only.cy.js',
    });
    runSpecSource(source, globals);
    assert.deepEqual(registered.suites, ['Confirmed bugs', 'G. Sprint 3 guard', 'Sprint 4']);
    assert.deepEqual(registered.tests, ['g1', 's1', 's2']);
});

// C2. A context under an unreadable title could be ticked and could never match.

test('C2: a context inside one whose title cannot be read cannot be ticked', () => {
    const r = pick('unreadable-parent.cy.js', ['open']);
    const labels = r.rows.map((x) => x.label);
    assert.deepEqual(labels, [
        'cypress/e2e/unreadable-parent.cy.js',
        '(title built at run time)',
        'valid values',
        'Plain',
    ]);
    assert.equal(r.rows[2].selectable, false);
    assert.equal(r.rows[2].note, 'inside a context whose title cannot be read');
});

test('C2: pressing space on such a context changes nothing', () => {
    const r = pick('unreadable-parent.cy.js', ['open', 'down', 'down', 'toggle']);
    assert.deepEqual(r.selection.specs, []);
    assert.deepEqual(r.registered.tests, []);
});

test('C2: the readable sibling still works', () => {
    const r = pick('unreadable-parent.cy.js', ['open', 'down', 'down', 'down', 'toggle']);
    assert.deepEqual(r.entry.include, [['Root', 'Plain']]);
    assert.deepEqual(r.registered.tests, ['p1']);
});

// S1. A filter that matches nothing must stop the spec rather than run no tests.

test('S1: a filter that matches nothing throws, naming the spec and the titles', () => {
    // The spec was picked, then changed before it ran, so the ticked titles are gone.
    const r = pick('nested.cy.js', ['open', 'down', 'toggle'], { runInstead: 'multi-top.cy.js' });
    assert.deepEqual(r.registered.tests, []);
    assert.throws(
        () => r.installed.assertSomethingMatched(),
        (err) => {
            assert.match(err.message, /nested\.cy\.js/);
            assert.match(err.message, /Root > A/);
            return true;
        }
    );
});

test('S1: a filter that does match stays quiet', () => {
    const r = pick('nested.cy.js', ['open', 'down', 'toggle']);
    assert.deepEqual(r.registered.tests, ['a1', 'a2']);
    r.installed.assertSomethingMatched();
});

test('S1: a run with no filter at all stays quiet', () => {
    const { globals } = fakeMocha();
    const installed = installFilter({ globals, selected: [], excluded: [], spec: 'a.cy.js' });
    installed.assertSomethingMatched();
});

// I4. A spec written as several outermost suites.

test('I4: both outermost suites are listed, and one of them can be run on its own', () => {
    const r = pick('multi-top.cy.js', ['open', 'down', 'down', 'toggle']);
    assert.deepEqual(r.rows.map((x) => x.label), [
        'cypress/e2e/multi-top.cy.js',
        'First',
        'Second',
    ]);
    assert.deepEqual(r.entry.include, [['Second']]);
    assert.deepEqual(r.registered.tests, ['s1']);
    assert.equal(r.registered.suites.includes('First'), false);
});
