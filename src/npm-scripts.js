'use strict';

// Which of the host project's scripts the picker will offer to run.
//
// Everything is offered except a script that opens the Cypress window, directly or
// through another script it calls. The window is a different way of working and the
// picked specs would not reach it.

function commandsFor(packageJson) {
    return (packageJson && packageJson.scripts) || {};
}

function opensTheWindow(name, scripts, seen) {
    if (seen.has(name)) return false;
    seen.add(name);

    const command = scripts[name];
    if (!command) return false;
    if (/cypress\s+open/.test(command)) return true;

    const called = command.match(/npm\s+run\s+([\w:.-]+)/g) || [];
    return called.some((piece) => opensTheWindow(piece.replace(/npm\s+run\s+/, ''), scripts, seen));
}

function runnableScripts(packageJson) {
    const scripts = commandsFor(packageJson);
    return Object.keys(scripts)
        .filter((name) => !opensTheWindow(name, scripts, new Set()))
        .map((name) => ({ name, command: scripts[name] }));
}

module.exports = { runnableScripts };
