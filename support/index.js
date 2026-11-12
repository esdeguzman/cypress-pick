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

const NOTHING_PICKED = { include: [], exclude: [], present: false };

// The picker writes spec paths with forward slashes. Cypress reports the running
// spec with the separator the operating system uses, which is a backslash on
// Windows, so one of the two has to be made to match the other.
function selectedFor(filter, relative) {
    if (!filter || !relative) return NOTHING_PICKED;
    const entry = filter[relative.replace(/\\/g, '/')];
    if (!entry) return NOTHING_PICKED;
    // A plain list is what an older version of the command wrote, before the
    // unticked contexts started travelling alongside the ticked ones.
    if (Array.isArray(entry)) return { include: entry, exclude: [], present: true };
    return { include: entry.include || [], exclude: entry.exclude || [], present: true };
}

function describePath(path) {
    return path.join(' > ');
}

// Runs the check once the spec file has been read. A microtask runs at the end of
// the current piece of synchronous work, and the check is only ever scheduled from
// inside a suite call, so that piece of work is the spec file itself. Scheduling it
// when the filter is installed would be too early: the support file is loaded first,
// and its microtasks run before the spec file is even fetched.
function afterTheSpecFileIsRead(fn) {
    if (typeof queueMicrotask === 'function') queueMicrotask(fn);
    else setTimeout(fn, 0);
}

function installFilter({ globals, selected, excluded, spec, schedule }) {
    const picked = selected || [];
    const dropped = excluded || [];
    if (picked.length === 0) return { matchedCount: () => 0, assertSomethingMatched: () => {} };

    const stack = [];
    let matched = 0;
    let checkScheduled = false;
    // How many only suites the scan is currently inside. Above zero, nothing is
    // filtered out, because Mocha's only has already decided what runs.
    let insideOnly = 0;

    // A filter that matches nothing leaves the run with no tests, and Cypress then
    // exits reporting no failures. That is the outcome this package exists to
    // prevent, so the spec is stopped instead. A spec that fails to load is loud.
    const assertSomethingMatched = () => {
        if (matched > 0) return;
        throw new Error(
            'cypress-pick: none of the contexts picked for ' + (spec || 'this spec') +
            ' were found, so the run would have had no tests. Picked: ' +
            picked.map((path) => '"' + describePath(path) + '"').join(', ') +
            '. The spec may have changed since it was picked. Run it again without the picker, ' +
            'or pick it again.'
        );
    };

    const scheduleCheck = () => {
        if (checkScheduled) return;
        checkScheduled = true;
        (schedule || afterTheSpecFileIsRead)(assertSomethingMatched);
    };

    // Runs the suite's body with its title added to the stack, so that everything
    // inside it is judged against the full chain of titles it really sits in.
    // `countsAsOnly` keeps that stack honest for an only suite as well.
    const withTitleOnStack = (title, rest, last, countsAsOnly) => {
        const body = rest.slice();
        body[body.length - 1] = function (...args) {
            stack.push(String(title));
            if (countsAsOnly) insideOnly += 1;
            try {
                return last.apply(this, args);
            } finally {
                if (countsAsOnly) insideOnly -= 1;
                stack.pop();
            }
        };
        return body;
    };

    const wrapSuite = (original) => function (title, ...rest) {
        scheduleCheck();
        const path = stack.concat(String(title));
        if (shouldRegisterTest(path, picked, dropped)) matched += 1;
        if (insideOnly === 0 && !shouldRegisterSuite(path, picked, dropped)) return undefined;

        const last = rest[rest.length - 1];
        if (typeof last !== 'function') return original.call(this, title, ...rest);
        return original.call(this, title, ...withTitleOnStack(title, rest, last, false));
    };

    // Mocha's only beats anything this package does, and the command warns about
    // that rather than trying to defeat it. So an only suite is handed straight to
    // Mocha's own only, and nothing inside it is filtered out.
    //
    // It still has to be wrapped for one reason: the title has to go on the stack
    // while the body runs. Without that, every test inside an only suite was judged
    // against a stack that did not contain it, so the suite registered with no tests
    // in it at all, and Mocha then ran that empty suite and nothing else.
    const wrapOnly = (original) => function (title, ...rest) {
        scheduleCheck();
        if (shouldRegisterTest(stack.concat(String(title)), picked, dropped)) matched += 1;
        const last = rest[rest.length - 1];
        if (typeof last !== 'function') return original.call(this, title, ...rest);
        return original.call(this, title, ...withTitleOnStack(title, rest, last, true));
    };

    const wrapTest = (original) => function (title, ...rest) {
        if (insideOnly === 0 && !shouldRegisterTest(stack.slice(), picked, dropped)) return undefined;
        return original.call(this, title, ...rest);
    };

    for (const name of ['describe', 'context']) {
        if (typeof globals[name] !== 'function') continue;
        const original = globals[name];
        const wrapped = wrapSuite(original);
        wrapped.only = typeof original.only === 'function' ? wrapOnly(original.only) : original.only;
        wrapped.skip = original.skip;
        globals[name] = wrapped;
    }
    for (const name of ['it', 'specify']) {
        if (typeof globals[name] !== 'function') continue;
        const original = globals[name];
        const wrapped = wrapTest(original);
        // A test carrying only is Mocha's decision too, so it is passed through.
        wrapped.only = original.only;
        wrapped.skip = original.skip;
        globals[name] = wrapped;
    }

    return { matchedCount: () => matched, assertSomethingMatched };
}

// Runs when a host project imports this file. Guarded so that requiring the module
// in Node, which the tests do, installs nothing.
if (typeof Cypress !== 'undefined' && typeof window !== 'undefined') {
    const filter = decode(readFilterText(Cypress));
    const relative = Cypress.spec && Cypress.spec.relative;
    const entry = selectedFor(filter, relative);
    installFilter({
        globals: window,
        selected: entry.include,
        excluded: entry.exclude,
        spec: relative,
    });
}

module.exports = { installFilter, selectedFor, readFilterText };
