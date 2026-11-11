'use strict';

const { spawnSync } = require('node:child_process');

// shell is on because the commands are npx and npm, which on Windows are batch
// files and cannot be started without one.
function runCypress(args, { cwd }) {
    const result = spawnSync('npx', ['cypress', 'run', ...args], { cwd, stdio: 'inherit', shell: true });
    return result.status === null ? 1 : result.status;
}

function runNpmScript(name, { cwd, env }) {
    const result = spawnSync('npm', ['run', name], {
        cwd,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, ...env },
    });
    return result.status === null ? 1 : result.status;
}

module.exports = { runCypress, runNpmScript };
