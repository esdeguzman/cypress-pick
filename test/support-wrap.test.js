'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { installFilter } = require('../support/index.js');

// A stand-in for Mocha. Registering a suite runs its callback straight away, which
// is what Mocha does, and is what lets the wrapper track which suite it is inside.
function fakeMocha() {
    const registered = { suites: [], tests: [] };
    const globals = {};

    const suite = (title, ...rest) => {
        registered.suites.push(title);
        const fn = rest[rest.length - 1];
        if (typeof fn === 'function') fn();
    };
    const testFn = (title) => { registered.tests.push(title); };

    globals.describe = suite;
    globals.describe.only = suite;
    globals.describe.skip = () => {};
    globals.context = suite;
    globals.context.only = suite;
    globals.context.skip = () => {};
    globals.it = testFn;
    globals.it.only = testFn;
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
    installFilter({ globals, selected: [['Root', 'B']] });
    runSpec(globals);
    assert.equal(registered.tests.includes('loose test'), false);
    assert.deepEqual(registered.tests, ['b one']);
});

test('only and skip are left exactly as they were', () => {
    // Mocha's only beats anything this package does, and the picker warns about that
    // rather than trying to defeat it. So the only and skip forms are not wrapped.
    const { globals } = fakeMocha();
    const beforeOnly = globals.describe.only;
    const beforeSkip = globals.describe.skip;
    installFilter({ globals, selected: [['Root', 'A']] });
    assert.equal(globals.describe.only, beforeOnly);
    assert.equal(globals.describe.skip, beforeSkip);
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
