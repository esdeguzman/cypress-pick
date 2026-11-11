'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Finds the command script that the host project's own install of Cypress carries,
// not cypress-pick's. The version that matters is whatever the host project tested
// against, and resolving "cypress/package.json" with the host directory in the
// search path is how Node finds a package installed there instead of here.
function resolveCypressBin(cwd) {
    let pkgPath;
    try {
        pkgPath = require.resolve('cypress/package.json', { paths: [cwd] });
    } catch (err) {
        return null;
    }
    const pkg = require(pkgPath);
    const binField = pkg.bin;
    const relative = typeof binField === 'string' ? binField : binField && binField.cypress;
    if (!relative) return null;
    return path.resolve(path.dirname(pkgPath), relative);
}

// The executable and the argument list a Cypress run would use, decided without
// starting anything. Kept apart from the code that spawns it so a test can check
// the arguments on their own. With no shell involved, each array entry reaches the
// child process as its own argument: a space inside a spec path cannot split it in
// two, and a character such as & cannot start a second command, because there is no
// shell reading the line to find one.
function buildCypressSpawnPlan(cwd, args) {
    const entry = resolveCypressBin(cwd);
    if (!entry) return null;
    return { command: process.execPath, args: [entry, 'run', ...args] };
}

function runCypress(args, { cwd }) {
    const plan = buildCypressSpawnPlan(cwd, args);
    if (!plan) {
        process.stdout.write('\n  Cypress is not installed in ' + cwd + '.\n' +
            '  Run npm install cypress there, then try cypress-pick again.\n\n');
        return 1;
    }
    const result = spawnSync(plan.command, plan.args, { cwd, stdio: 'inherit', shell: false });
    return result.status === null ? 1 : result.status;
}

// npm is still started through a shell, because on Windows it is a batch file and
// will not start without one. That is safe here because the only value reaching
// this command line is the script name, and it is checked below against the names
// read from the host project's own package.json before anything is spawned. The
// picked specs themselves travel in an environment variable, not on this command
// line, so they are never at risk the way the Cypress command's arguments were.
function runNpmScript(name, { cwd, env, scripts }) {
    if (!Array.isArray(scripts) || !scripts.includes(name)) {
        process.stdout.write('\n  "' + name + '" is not one of this project\'s scripts, so nothing was run.\n\n');
        return 1;
    }
    const result = spawnSync('npm', ['run', name], {
        cwd,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, ...env },
    });
    return result.status === null ? 1 : result.status;
}

module.exports = { runCypress, runNpmScript, resolveCypressBin, buildCypressSpawnPlan };
