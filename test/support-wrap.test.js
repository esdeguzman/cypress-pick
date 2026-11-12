'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { installFilter, selectedFor, readFilterText } = require('../support/index.js');

// A stand-in for Mocha. Registering a suite runs its callback straight away, which
// is what Mocha does, and is what lets the wrapper track which suite it is inside.
// What was registered through only is recorded separately, because this package
// must not change what Mocha does with it.
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

    return { registered, globals };
}

function runSpec(globals) {
    const { describe, context, it } = globals;
    describe('Root', () => {
        it('loose test', () => {});
        context('A', () => {
            it('a one', () => {});
            context('A nested', () => {
                it('a nested one', () => {});
            });
        });
        context('B', () => {
            it('b one', () => {});
        });
    });
}

test('with no filter everything is registered', () => {
    const { registered, globals } = fakeMocha();
    installFilter({ globals, selected: [] });
    runSpec(globals);
    assert.deepEqual(registered.suites, ['Root', 'A', 'A nested', 'B']);
    assert.deepEqual(registered.tests, ['loose test', 'a one', 'a nested one', 'b one']);
});

test('one ticked context registers that context, its parent and its children only', () => {
    const { registered, globals } = fakeMocha();
    installFilter({ globals, selected: [['Root', 'A']] });
    runSpec(globals);
    assert.deepEqual(registered.suites, ['Root', 'A', 'A nested']);
    assert.deepEqual(registered.tests, ['a one', 'a nested one']);
});

test('a loose test in the outermost suite is left out of a narrowed run', () => {
    const { registered, globals } = fakeMocha();
    // schedule is held because these tests are about only, not about the check for
    // a filter that matched nothing. That check has its own tests in pipeline.test.js,
    // and left to fire on its own here it throws after the test has finished.
    installFilter({ globals, selected: [['Root', 'B']], schedule: () => {} });
    runSpec(globals);
    assert.equal(registered.tests.includes('loose test'), false);
    assert.deepEqual(registered.tests, ['b one']);
});

// Finding C1. Mocha's only still beats anything this package does, and the picker
// warns about that rather than trying to defeat it. What it must not do is lose
// track of which suite it is inside while an only suite's body runs, because every
// test in that body is then judged against the wrong list of titles.

test('C1: an only suite keeps the titles in step, so its own tests still register', () => {
    const { registered, globals } = fakeMocha();
    // schedule is held because these tests are about only, not about the check for
    // a filter that matched nothing. That check has its own tests in pipeline.test.js,
    // and left to fire on its own here it throws after the test has finished.
    installFilter({ globals, selected: [['Root', 'B']], schedule: () => {} });
    globals.describe('Root', () => {
        globals.context.only('A', () => {
            globals.it('a one', () => {});
        });
        globals.context('B', () => { globals.it('b one', () => {}); });
    });
    assert.deepEqual(registered.suites, ['Root', 'A', 'B']);
    assert.deepEqual(registered.tests, ['a one', 'b one']);
});

test('C1: a context inside an only suite registers too', () => {
    const { registered, globals } = fakeMocha();
    // schedule is held because these tests are about only, not about the check for
    // a filter that matched nothing. That check has its own tests in pipeline.test.js,
    // and left to fire on its own here it throws after the test has finished.
    installFilter({ globals, selected: [['Root', 'B']], schedule: () => {} });
    globals.describe('Root', () => {
        globals.context.only('A', () => {
            globals.context('A inner', () => { globals.it('deep', () => {}); });
        });
    });
    assert.deepEqual(registered.suites, ['Root', 'A', 'A inner']);
    assert.deepEqual(registered.tests, ['deep']);
});

test('C1: the only form still calls through to the host runner\'s own only', () => {
    const { registered, globals } = fakeMocha();
    // schedule is held because these tests are about only, not about the check for
    // a filter that matched nothing. That check has its own tests in pipeline.test.js,
    // and left to fire on its own here it throws after the test has finished.
    installFilter({ globals, selected: [['Root', 'B']], schedule: () => {} });
    globals.describe.only('Root', () => {});
    assert.deepEqual(registered.only, ['Root']);
});

test('skip is left exactly as it was', () => {
    const { globals } = fakeMocha();
    const beforeSkip = globals.describe.skip;
    installFilter({ globals, selected: [['Root', 'A']] });
    assert.equal(globals.describe.skip, beforeSkip);
});

// Finding S1. A filter that matches nothing excludes every test, and the run then
// reports no failures. That is the outcome this package exists to prevent, so it
// has to stop the spec instead.

test('S1: a filter that matched nothing throws, naming the spec and the titles', () => {
    const { globals } = fakeMocha();
    const installed = installFilter({
        globals,
        selected: [['Root', 'Gone']],
        spec: 'cypress/e2e/x.cy.js',
        // Called by hand below. Left to fire on its own it throws once the test has
        // already finished, which the test runner reports against the whole file.
        schedule: () => {},
    });
    runSpec(globals);
    assert.throws(() => installed.assertSomethingMatched(), /cypress\/e2e\/x\.cy\.js/);
    assert.throws(() => installed.assertSomethingMatched(), /Root > Gone/);
});

test('S1: it counts the suites that matched', () => {
    const { globals } = fakeMocha();
    const installed = installFilter({ globals, selected: [['Root', 'A']], spec: 'x.cy.js' });
    runSpec(globals);
    // "A" and the "A nested" inside it both sit under the ticked path.
    assert.equal(installed.matchedCount(), 2);
    installed.assertSomethingMatched();
});

test('S1: the check is scheduled for the moment the spec file has finished loading', () => {
    // The support file is loaded before the spec, so the check cannot be scheduled
    // when the filter is installed. It is scheduled the first time the spec calls
    // describe or context, which is while the spec file is being read.
    const { globals } = fakeMocha();
    const scheduled = [];
    installFilter({
        globals,
        selected: [['Root', 'Gone']],
        spec: 'x.cy.js',
        schedule: (fn) => scheduled.push(fn),
    });
    assert.equal(scheduled.length, 0);
    runSpec(globals);
    assert.equal(scheduled.length, 1);
    assert.throws(() => scheduled[0]());
});

test('S1: nothing is scheduled when there is no filter', () => {
    const { globals } = fakeMocha();
    const scheduled = [];
    installFilter({ globals, selected: [], spec: 'x.cy.js', schedule: (fn) => scheduled.push(fn) });
    runSpec(globals);
    assert.equal(scheduled.length, 0);
});

// selectedFor and readFilterText are what the browser half calls before any of the
// above can happen. Neither had a test.

test('selectedFor finds the spec when Cypress reports it with backslashes', () => {
    const filter = { 'cypress/e2e/a.cy.js': { include: [['Root', 'A']], exclude: [] } };
    const entry = selectedFor(filter, 'cypress\\e2e\\a.cy.js');
    assert.deepEqual(entry.include, [['Root', 'A']]);
    assert.equal(entry.present, true);
});

test('selectedFor finds the spec when it is reported with forward slashes', () => {
    const filter = { 'cypress/e2e/a.cy.js': { include: [['Root', 'A']], exclude: [] } };
    assert.deepEqual(selectedFor(filter, 'cypress/e2e/a.cy.js').include, [['Root', 'A']]);
});

test('selectedFor returns an empty entry for a spec that was not narrowed', () => {
    const filter = { 'cypress/e2e/a.cy.js': { include: [['Root', 'A']], exclude: [] } };
    const entry = selectedFor(filter, 'cypress/e2e/b.cy.js');
    assert.deepEqual(entry.include, []);
    assert.deepEqual(entry.exclude, []);
    assert.equal(entry.present, false);
});

test('selectedFor copes with no filter and with no spec name', () => {
    assert.equal(selectedFor(null, 'a.cy.js').present, false);
    assert.equal(selectedFor({ 'a.cy.js': { include: [], exclude: [] } }, null).present, false);
});

test('readFilterText prefers the Cypress 16 reader', () => {
    const cypress = { expose: (key) => (key === 'cypressPick' ? 'from-expose' : null), env: () => 'from-env' };
    assert.equal(readFilterText(cypress), 'from-expose');
});

test('readFilterText falls back to the older reader', () => {
    assert.equal(readFilterText({ env: (key) => (key === 'cypressPick' ? 'from-env' : null) }), 'from-env');
});

test('readFilterText falls back when the newer reader throws', () => {
    const cypress = {
        expose: () => { throw new Error('no expose on this version'); },
        env: () => 'from-env',
    };
    assert.equal(readFilterText(cypress), 'from-env');
});

test('readFilterText returns nothing when there is no filter to read', () => {
    assert.equal(readFilterText({ env: () => undefined }), null);
    assert.equal(readFilterText(null), null);
    assert.equal(readFilterText({}), null);
});

test('specify is filtered the same way as it', () => {
    const { registered, globals } = fakeMocha();
    installFilter({ globals, selected: [['Root', 'A']] });
    globals.describe('Root', () => {
        globals.context('B', () => { globals.specify('b spec', () => {}); });
        globals.context('A', () => { globals.specify('a spec', () => {}); });
    });
    assert.deepEqual(registered.tests, ['a spec']);
});
