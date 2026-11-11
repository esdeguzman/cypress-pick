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
