'use strict';

const { FILTER_KEY } = require('./src/build-args');

// For a project whose own script builds the Cypress command, such as a script that
// chains several commands together. There is no single place to add an argument to
// such a chain, so the picked specs travel in environment variables and the
// project's runner adds the flags itself:
//
//   const { applyPick } = require('cypress-pick/runner');
//   return applyPick(args, env);
//
// The variables are named CYPICK rather than CYPRESS because Cypress claims the
// CYPRESS prefix for its own configuration and environment overrides.
//
// Order matters if your own script also has a fallback that adds a spec flag from
// somewhere else, such as a project-specific SPEC environment variable. Call
// applyPick first, and only add your own fallback spec afterward, and only if no
// spec flag is present yet. Picking a spec is something a person just did on
// purpose. A variable like SPEC can be left set from an earlier day's work and has
// nothing to do with what was just picked, so it must never be allowed to beat it.
// If you add your fallback before calling applyPick, your fallback always wins,
// because applyPick only adds a spec flag when one is not already there.
function applyPick(args, env) {
    const source = env || process.env;
    if (!source.CYPICK_SPEC) return args;

    const out = args.slice();
    const hasSpec = out.some((a) => a === '--spec' || a === '-s' || a.startsWith('--spec='));
    if (!hasSpec) out.push('--spec', source.CYPICK_SPEC);
    if (source.CYPICK_FILTER) {
        out.push(source.CYPICK_FLAG || '--expose', FILTER_KEY + '=' + source.CYPICK_FILTER);
    }
    return out;
}

module.exports = { applyPick };
