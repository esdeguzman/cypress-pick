'use strict';

// The browser half of cypress-pick. A host project imports this once, in its Cypress
// support file:
//
//   import 'cypress-pick/support'
//
// With no filter present it changes nothing, so every existing way of running the
// project behaves as it did. With one, the contexts that were not ticked are never
// registered at all, which means they produce no test and no pending entry in a
// report.

const { shouldRegisterSuite, shouldRegisterTest } = require('../src/match');
const { decode } = require('../src/filter-codec');
const { FILTER_KEY } = require('../src/build-args');

// Cypress 16 reads this with Cypress.expose. Earlier versions have no expose and
// read it with Cypress.env instead.
function readFilterText(cy) {
    try {
        if (cy && typeof cy.expose === 'function') {
            const value = cy.expose(FILTER_KEY);
            if (value) return value;
        }
    } catch (err) {
        // Falls through to the older reader below.
    }
    try {
        if (cy && typeof cy.env === 'function') return cy.env(FILTER_KEY) || null;
    } catch (err) {
        return null;
    }
    return null;
}

// The picker writes spec paths with forward slashes. Cypress reports the running
// spec with the separator the operating system uses, which is a backslash on
// Windows, so one of the two has to be made to match the other.
function selectedFor(filter, relative) {
    if (!filter || !relative) return [];
    return filter[relative.replace(/\\/g, '/')] || [];
}

function installFilter({ globals, selected }) {
    if (!selected || selected.length === 0) return;

    const stack = [];

    const wrapSuite = (original) => {
        const wrapped = function (title, ...rest) {
            const path = stack.concat(String(title));
            if (!shouldRegisterSuite(path, selected)) return undefined;

            const last = rest[rest.length - 1];
            if (typeof last !== 'function') return original.call(this, title, ...rest);

            const body = rest.slice();
            body[body.length - 1] = function (...args) {
                stack.push(String(title));
                try {
                    return last.apply(this, args);
                } finally {
                    stack.pop();
                }
            };
            return original.call(this, title, ...body);
        };
        // only and skip keep their own meaning, so they are passed through untouched.
        wrapped.only = original.only;
        wrapped.skip = original.skip;
        return wrapped;
    };

    const wrapTest = (original) => {
        const wrapped = function (title, ...rest) {
            if (!shouldRegisterTest(stack.slice(), selected)) return undefined;
            return original.call(this, title, ...rest);
        };
        wrapped.only = original.only;
        wrapped.skip = original.skip;
        return wrapped;
    };

    for (const name of ['describe', 'context']) {
        if (typeof globals[name] === 'function') globals[name] = wrapSuite(globals[name]);
    }
    for (const name of ['it', 'specify']) {
        if (typeof globals[name] === 'function') globals[name] = wrapTest(globals[name]);
    }
}

// Runs when a host project imports this file. Guarded so that requiring the module
// in Node, which the tests do, installs nothing.
if (typeof Cypress !== 'undefined' && typeof window !== 'undefined') {
    const filter = decode(readFilterText(Cypress));
    installFilter({
        globals: window,
        selected: selectedFor(filter, Cypress.spec && Cypress.spec.relative),
    });
}

module.exports = { installFilter, selectedFor, readFilterText };
