'use strict';

const { terms, scoreTerm } = require('./fuzzy');

// Which specs and contexts a query finds. Takes the specs of the list state, and
// knows nothing about the terminal.

// A spec found by its name comes before one found by a context, because a name is
// the shorter text and so the more likely thing to have been typed.
const CONTEXT_PENALTY = 60;

// The folders every spec sits in, for example cypress/e2e/. They are left out of the
// search, because a term found in them would find every spec there is.
function sharedFolder(specs) {
    let shared = null;
    for (const spec of specs) {
        const folders = spec.relative.split('/').slice(0, -1);
        if (shared === null) shared = folders;
        let same = 0;
        while (same < shared.length && shared[same] === folders[same]) same += 1;
        shared = shared.slice(0, same);
    }
    return shared && shared.length > 0 ? shared.join('/') + '/' : '';
}

// Scores a term against the path of a spec, without the shared folders and without
// the .cy.js ending, which every spec has too. A term with a slash or a dot in it is
// part of a path that was typed or pasted, so that one is looked for in all of it.
function scoreSpec(term, relative, shared) {
    if (/[/.]/.test(term)) return scoreTerm(term, relative);
    const trimmed = relative.slice(shared.length).replace(/(\.(cy|spec|test))?\.[^./]+$/, '');
    const name = trimmed.split('/').pop();
    return Math.max(scoreTerm(term, trimmed), scoreTerm(term, name, { loose: true }));
}

function average(numbers) {
    return numbers.reduce((total, n) => total + n, 0) / numbers.length;
}

function isOnPath(path, parent) {
    return path.length >= parent.length && parent.every((title, i) => path[i] === title);
}

// Returns a Map of spec index to { score, suites, firstHit }. `suites` holds the
// contexts to show under the spec, and `firstHit` is the first of them that really
// matched, rather than one shown because it holds a match, or -1.
//
// A spec found by its own name lists no contexts, because the spec is the answer.
// Otherwise at least one term has to be found in a context's own title. The rest may
// be found in the spec's name or in a parent's title, so that "login expired" finds
// the context Expired session in login.cy.js.
function findMatches(specs, query) {
    const wanted = terms(query);
    const found = new Map();
    if (wanted.length === 0) return found;
    const shared = sharedFolder(specs);

    specs.forEach((spec, specIndex) => {
        const inSpec = wanted.map((term) => scoreSpec(term, spec.relative, shared));
        if (inSpec.every((score) => score > 0)) {
            found.set(specIndex, { score: average(inSpec), suites: new Set(), firstHit: -1 });
            return;
        }

        const hits = [];
        let best = 0;
        spec.suites.forEach((suite, suiteIndex) => {
            if (suite.title === null) return;
            const own = wanted.map((term) => scoreTerm(term, suite.title));
            if (!own.some((score) => score > 0)) return;
            const parents = suite.path.slice(0, -1).filter((title) => typeof title === 'string').join(' ');
            const scores = wanted.map((term, i) => Math.max(own[i], inSpec[i], scoreTerm(term, parents)));
            if (!scores.every((score) => score > 0)) return;
            hits.push(suiteIndex);
            best = Math.max(best, average(scores));
        });
        if (hits.length === 0) return;

        // The contexts holding a match are shown too, so that its place is clear.
        const suites = new Set(hits);
        for (const hit of hits) {
            spec.suites.forEach((suite, suiteIndex) => {
                if (isOnPath(spec.suites[hit].path, suite.path)) suites.add(suiteIndex);
            });
        }
        found.set(specIndex, { score: best - CONTEXT_PENALTY, suites, firstHit: hits[0] });
    });
    return found;
}

module.exports = { findMatches };
