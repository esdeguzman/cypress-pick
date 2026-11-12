'use strict';

const { encode } = require('./filter-codec');

const FILTER_KEY = 'cypressPick';

// A spec whose contexts are all ticked produces no filter entry. That is what keeps
// the common case, ticking a spec and never opening it, producing exactly the
// command the project already runs today, so it cannot behave differently from it.
// A context that cannot be ticked, which today means a skipped one or one whose
// title could not be read, is left out of that judgement.
//
// The unticked contexts travel as well as the ticked ones. Without them, a ticked
// parent let back in a child that the person had just unticked, because the child
// sits inside something ticked, and the list then said "some contexts" while every
// test in the spec ran.
//
// A spec carrying `only` is sent whole, with no filter at all. Mocha's `only`
// decides what runs in that file whatever this package does, so sending a filter
// would describe something that is not going to happen. The command warns about the
// marker before the run instead, and that warning is then true of the run.
function buildSelection(specs) {
    const picked = specs.filter((s) => s.checked);
    const filter = {};

    for (const s of picked) {
        if (s.hasOnly) continue;
        const selectable = s.suites.filter((x) => x.selectable);
        const ticked = selectable.filter((x) => x.checked);
        // A context that cannot be ticked but would still run means the spec cannot
        // be sent whole, even when every tickable context is ticked. Sending it
        // whole would run that context as well, which is not what was asked for.
        const runsAnyway = s.suites.some((x) => x.runsAnyway);
        if (!runsAnyway && (selectable.length === 0 || ticked.length === selectable.length)) continue;
        filter[s.relative] = {
            include: ticked.map((x) => x.path),
            exclude: selectable.filter((x) => !x.checked).map((x) => x.path),
        };
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
