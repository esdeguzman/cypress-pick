'use strict';

const { encode } = require('./filter-codec');

const FILTER_KEY = 'cypressPick';

// A spec whose contexts are all ticked produces no filter entry. That is what keeps
// the common case, ticking a spec and never opening it, producing exactly the
// command the project already runs today, so it cannot behave differently from it.
// A context that cannot be ticked, which today means a skipped one, is left out of
// that judgement.
function buildSelection(specs) {
    const picked = specs.filter((s) => s.checked);
    const filter = {};

    for (const s of picked) {
        const selectable = s.suites.filter((x) => x.selectable);
        const ticked = selectable.filter((x) => x.checked);
        if (selectable.length === 0 || ticked.length === selectable.length) continue;
        filter[s.relative] = ticked.map((x) => x.path);
    }

    return { specs: picked.map((s) => s.relative), filter };
}

// Cypress 16 removed Cypress.env() and added the --expose flag in its place, so the
// flag depends on the host project's version.
function flagFor(cypressMajor) {
    return cypressMajor >= 16 ? '--expose' : '--env';
}

function buildArgs(selection, { cypressMajor }) {
    const args = ['--spec', selection.specs.join(',')];
    if (Object.keys(selection.filter).length === 0) return args;
    args.push(flagFor(cypressMajor), FILTER_KEY + '=' + encode(selection.filter));
    return args;
}

// Used when the picker runs one of the host project's own scripts. The script's own
// runner reads these and adds the flags itself, because a script that chains several
// commands has no single place to add an argument to.
function buildEnv(selection, { cypressMajor }) {
    const env = {
        CYPICK_SPEC: selection.specs.join(','),
        CYPICK_FLAG: flagFor(cypressMajor),
    };
    if (Object.keys(selection.filter).length > 0) {
        env.CYPICK_FILTER = encode(selection.filter);
    }
    return env;
}

module.exports = { buildSelection, buildArgs, buildEnv, FILTER_KEY };
