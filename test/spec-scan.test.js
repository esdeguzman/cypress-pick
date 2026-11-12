'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { scanFile, listableSuites, summariseScan } = require('../src/spec-scan');

const fixture = (name) => path.join(__dirname, 'fixtures', name);

test('it reads every suite with its nesting and its title path', () => {
    const { suites } = scanFile(fixture('simple.cy.js'));
    assert.deepEqual(
        suites.map((s) => [s.depth, s.title]),
        [
            [0, 'Projects'],
            [1, 'Search'],
            [1, 'Pagination'],
            [2, 'Multi-page navigation'],
            [1, 'Project Details'],
        ]
    );
    assert.deepEqual(suites[3].path, ['Projects', 'Pagination', 'Multi-page navigation']);
});

test('it counts the tests in a suite, including those nested inside it', () => {
    // The count is of tests that will run. The one test inside the skipped context
    // is counted as skipped instead, which is finding I2.
    const { suites, tests, skippedTests } = scanFile(fixture('simple.cy.js'));
    const byTitle = Object.fromEntries(suites.map((s) => [s.title, s.tests]));
    assert.equal(byTitle.Search, 2);
    assert.equal(byTitle.Pagination, 2);
    assert.equal(byTitle['Multi-page navigation'], 1);
    assert.equal(byTitle['Project Details'], 0);
    assert.equal(byTitle.Projects, 5);
    assert.equal(tests, 5);
    assert.equal(skippedTests, 1);
});

test('it records skip and only on the suite that carries them', () => {
    const { suites } = scanFile(fixture('simple.cy.js'));
    const details = suites.find((s) => s.title === 'Project Details');
    assert.equal(details.modifier, 'skip');
    assert.equal(suites.find((s) => s.title === 'Search').modifier, null);
});

test('it ignores suite names inside comments and strings', () => {
    const { suites } = scanFile(fixture('tricky.cy.js'));
    const titles = suites.map((s) => s.title);
    assert.equal(titles.includes('Not real'), false);
    assert.equal(titles.includes('Still not real'), false);
    assert.equal(titles.includes('fake'), false);
});

test('it reads a title containing quotes of the other kind', () => {
    const { suites } = scanFile(fixture('tricky.cy.js'));
    assert.ok(suites.some((s) => s.title === 'Quoted "double" and \'single\''));
});

test('it marks a title built from a template as unreadable', () => {
    const { suites } = scanFile(fixture('tricky.cy.js'));
    const unreadable = suites.filter((s) => s.readable === false);
    assert.equal(unreadable.length, 1);
    assert.equal(unreadable[0].title, null);
    assert.equal(unreadable[0].tests, 1);
});

test('it records only, counts specify as a test, and leaves it.skip out of the total', () => {
    const { suites, tests, skippedTests } = scanFile(fixture('tricky.cy.js'));
    const only = suites.find((s) => s.title === 'Only this one');
    assert.equal(only.modifier, 'only');
    assert.equal(only.tests, 1);
    assert.equal(only.skippedTests, 1);
    assert.equal(tests, 4);
    assert.equal(skippedTests, 1);
});

test('a suite declared with a config object is still read', () => {
    const { suites } = scanFile(fixture('tricky.cy.js'));
    assert.equal(suites[0].title, 'Root');
    assert.equal(suites[0].depth, 0);
    // Root holds every test in the file that will run: 1 in Quoted, 1 in the
    // template suite, 1 of the 2 in Only this one, and the specify. A config object
    // argument between the title and the callback must not stop these from being
    // counted as Root's.
    assert.equal(suites[0].tests, 4);
    const children = suites.slice(1);
    assert.equal(children.length, 3);
    for (const child of children) {
        assert.equal(child.depth, 1);
        assert.equal(child.path[0], 'Root');
    }
});

test('a regex containing an apostrophe does not open a string', () => {
    const { suites } = scanFile(fixture('regex.cy.js'));
    const titles = suites.map((s) => s.title);
    assert.ok(titles.includes('Apostrophe inside a regex'));
    assert.ok(titles.includes('Unmatched brace inside a regex'));
    assert.ok(titles.includes('Division is not a regex'));
});

test('a regex containing an unmatched brace does not close its suite early', () => {
    const { suites } = scanFile(fixture('regex.cy.js'));
    const target = suites.find((s) => s.title === 'Unmatched brace inside a regex');
    assert.equal(target.depth, 1);
    assert.equal(target.path[0], 'Regex traps');
    assert.equal(target.tests, 1);
});

test('a division expression is read as division, not as the start of a regex', () => {
    const { suites, tests } = scanFile(fixture('regex.cy.js'));
    assert.equal(tests, 3);
    const outer = suites.find((s) => s.title === 'Regex traps');
    assert.equal(outer.tests, 3);
});

// Finding I2. The counts printed by the command must be what will actually run.

test('I2: a skipped test and a test inside a skipped context are counted separately', () => {
    const { tests, skippedTests, onlyTests, suites } = scanFile(fixture('counting.cy.js'));
    assert.equal(tests, 2);
    assert.equal(skippedTests, 2);
    assert.equal(onlyTests, 1);
    const root = suites.find((s) => s.title === 'Root');
    assert.equal(root.tests, 2);
    assert.equal(root.skippedTests, 2);
});

test('I2: an only on a test is recorded, so the command can warn about it', () => {
    assert.equal(scanFile(fixture('counting.cy.js')).onlyTests, 1);
    assert.equal(scanFile(fixture('simple.cy.js')).onlyTests, 0);
});

// Finding C2b. A title that is joined to something else cannot be known either.

test('C2b: a title followed by a plus sign is marked unreadable', () => {
    const { suites } = scanFile(fixture('unreadable-parent.cy.js'));
    const row = suites.find((s) => s.depth === 1);
    assert.equal(row.readable, false);
    assert.equal(row.title, null);
});

test('C2b: the context after a joined title is still read', () => {
    const { suites } = scanFile(fixture('unreadable-parent.cy.js'));
    assert.deepEqual(suites.map((s) => s.title), ['Root', null, 'valid values', 'Plain']);
});

// Finding C2. A suite under one that cannot be ticked is recorded as such, so the
// list can refuse it too.

test('C2: a suite records that an ancestor of it cannot be ticked', () => {
    const { suites } = scanFile(fixture('unreadable-parent.cy.js'));
    const byTitle = Object.fromEntries(suites.map((s) => [String(s.title), s]));
    assert.equal(byTitle.Root.blockedBy, null);
    assert.equal(byTitle.null.blockedBy, null);
    assert.equal(byTitle['valid values'].blockedBy, 'unreadable');
    assert.equal(byTitle.Plain.blockedBy, null);
});

test('C2: a suite inside a skipped one records that too', () => {
    const { suites } = scanFile(fixture('tricky.cy.js'));
    assert.equal(suites.find((s) => s.title === 'Only this one').blockedBy, null);
});

// Finding I8. Two inputs that used to drop every context after them.

test('I8: a regex inside a suite config object does not swallow the rest of the file', () => {
    const { suites } = scanFile(fixture('regex-traps-2.cy.js'));
    assert.deepEqual(suites.map((s) => s.title), [
        'Root',
        'After the config object',
        'After an arrow',
        'After a return',
        'Last one',
    ]);
});

test('I8: a regex after an arrow or a return is read as a regex, not a division', () => {
    const { suites, tests } = scanFile(fixture('regex-traps-2.cy.js'));
    assert.equal(tests, 4);
    assert.equal(suites.find((s) => s.title === 'After an arrow').tests, 1);
    assert.equal(suites.find((s) => s.title === 'After a return').tests, 1);
});

// Finding I4. Which suites the list should show.

test('I4: a spec with one outermost suite lists what is inside it', () => {
    const { suites } = scanFile(fixture('simple.cy.js'));
    assert.deepEqual(listableSuites(suites).map((s) => s.title), [
        'Search',
        'Pagination',
        'Multi-page navigation',
        'Project Details',
    ]);
});

test('I4: a spec with several outermost suites lists those', () => {
    const { suites } = scanFile(fixture('multi-top.cy.js'));
    assert.deepEqual(listableSuites(suites).map((s) => s.title), ['First', 'Second']);
});

test('summariseScan gives the list everything it needs in one object', () => {
    const summary = summariseScan(scanFile(fixture('counting.cy.js')), { listContexts: true });
    assert.equal(summary.tests, 2);
    assert.equal(summary.skippedTests, 2);
    assert.equal(summary.onlyTests, 1);
    assert.deepEqual(summary.onlySuites, []);
    assert.deepEqual(summary.suites.map((s) => s.title), ['all skipped']);
});

test('summariseScan lists no contexts when the support file does not import the package', () => {
    const summary = summariseScan(scanFile(fixture('simple.cy.js')), { listContexts: false });
    assert.deepEqual(summary.suites, []);
    // Five, not six. The sixth sits inside a skipped context and will not run, so
    // it is counted as skipped instead. That is finding I2: the figure the command
    // prints has to be what will actually run.
    assert.equal(summary.tests, 5);
    assert.equal(summary.skippedTests, 1);
});

test('summariseScan reports an only on a suite at any depth', () => {
    const summary = summariseScan(scanFile(fixture('carries-only.cy.js')), { listContexts: true });
    assert.deepEqual(summary.onlySuites, [{ title: 'Sprint 4', tests: 2 }]);
});
