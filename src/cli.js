'use strict';

const path = require('node:path');
const { readHost, findSpecs, isSupportInstalled, DEFAULT_SPEC_PATTERN } = require('./host-config');
const { scanFile } = require('./spec-scan');
const { createState, toPickedSpecs, warnings } = require('./list-state');
const { promptList } = require('./checkbox-list');
const { buildSelection, buildArgs, buildEnv } = require('./build-args');
const { runnableScripts } = require('./npm-scripts');
const { runCypress, runNpmScript } = require('./run');

const HELP = [
    '',
    '  cypress-pick   tick the specs and contexts you want, then run only those',
    '',
    '  Usage',
    '    cypress-pick [options] [-- any cypress run flags]',
    '',
    '  Options',
    '    --spec-pattern <glob>   where to look for spec files, instead of the',
    '                            pattern in the Cypress config',
    '    --cwd <path>            the project to read, instead of this folder',
    '    -h, --help              show this',
    '',
    '  Anything after -- is passed to cypress run, for example:',
    '    cypress-pick -- --browser chrome',
    '',
].join('\n');

function parseArgs(argv) {
    const options = { passthrough: [], specPattern: null, cwd: null, help: false };
    const rest = argv.slice();
    while (rest.length > 0) {
        const arg = rest.shift();
        if (arg === '--') { options.passthrough = rest.splice(0); break; }
        else if (arg === '-h' || arg === '--help') options.help = true;
        else if (arg === '--spec-pattern') options.specPattern = rest.shift();
        else if (arg === '--cwd') options.cwd = rest.shift();
        else options.passthrough.push(arg);
    }
    return options;
}

// Same rule runner.js already applies on the environment-variable path: a spec flag
// the person typed themselves is what they meant, so it must win rather than sit
// next to the picked one, where which one Cypress obeys is not something this tool
// checks or tests.
function hasSpecFlag(argv) {
    return argv.some((a) => a === '--spec' || a === '-s' || a.startsWith('--spec='));
}

// buildArgs always puts the picked spec as its first two entries, ['--spec', value],
// so when a typed spec flag is present those two are dropped and only a filter flag,
// if there is one, is kept ahead of whatever the person typed.
function composeCypressArgs(selection, version, passthrough) {
    const built = buildArgs(selection, version);
    const args = hasSpecFlag(passthrough) ? built.slice(2) : built;
    return args.concat(passthrough);
}

// A spec typed on the command line wins over the picked ones, which is right: it is
// the more recent and more deliberate instruction. But the specs that were ticked
// were then thrown away without a word, so the person watched a run of something
// they had not chosen. Returns the line to print, or null when nothing was dropped.
function typedSpecNotice(passthrough, selection) {
    if (!hasSpecFlag(passthrough) || selection.specs.length === 0) return null;
    const typedIndex = passthrough.findIndex((a) => a === '--spec' || a === '-s' || a.startsWith('--spec='));
    const typed = passthrough[typedIndex].startsWith('--spec=')
        ? passthrough[typedIndex].slice('--spec='.length)
        : passthrough[typedIndex + 1];
    return 'You typed a spec, ' + typed + ', so that is what will run. The ' +
        selection.specs.length + ' you ticked were not used: ' + selection.specs.join(', ');
}

// Reads the ticked rows of the run-mode list and decides what to do, without
// touching the prompt itself, so this can be tested without a terminal. `how` is
// null only when the choice was ambiguous; `message` is a line to print either way,
// or null when there is nothing to say.
function decideHow(state, scripts) {
    const ticked = state.specs.filter((s) => s.checked);
    if (ticked.length > 1) {
        return { how: null, message: 'Only one way of running can be chosen at a time. Nothing was run.' };
    }
    if (ticked.length === 0) {
        return { how: { kind: 'cypress' }, message: 'Nothing was ticked, so Cypress will run directly.' };
    }
    const picked = state.specs.findIndex((s) => s.checked);
    if (picked === 0) return { how: { kind: 'cypress' }, message: null };
    return { how: { kind: 'script', name: scripts[picked - 1].name }, message: null };
}

// A second list, reusing the same widget, so the run mode is picked the same way the
// specs were. Running Cypress directly is always first because it needs no setup in
// the host project.
async function chooseHow(scripts, { stdout, stdin }) {
    const choices = [{ relative: 'run cypress directly', tests: 0, suites: [] }].concat(
        scripts.map((s) => ({ relative: 'npm run ' + s.name, tests: 0, suites: [] }))
    );
    const picked = await promptList(createState(choices), {
        title: 'How should it run? Move to one, press space, then enter.',
        stdout,
        stdin,
    });
    if (!picked) return null;
    return decideHow(picked.state, scripts);
}

async function main(argv, { cwd = process.cwd(), stdout = process.stdout, stdin = process.stdin } = {}) {
    const options = parseArgs(argv);
    if (options.help) { stdout.write(HELP); return 0; }

    const root = options.cwd ? path.resolve(options.cwd) : cwd;
    const host = readHost(root);
    if (options.specPattern) host.specPattern = [options.specPattern];

    // This notice explains the pattern that the next message complains about, so it
    // has to come first. Printed after the exit below, a person whose config could
    // not be read saw only a pattern they never configured, with no hint why.
    if (!host.configRead) {
        stdout.write('\n  The Cypress config could not be read, so the default pattern ' +
            DEFAULT_SPEC_PATTERN + ' was used.\n');
    }

    const files = findSpecs(root, host);
    if (files.length === 0) {
        stdout.write('\n  No spec files found under ' + host.specPattern.join(', ') + '\n');
        stdout.write('  Use --spec-pattern to say where they are.\n\n');
        return 1;
    }

    const supportInstalled = isSupportInstalled(root, host);
    const scanned = files.map((relative) => {
        const result = scanFile(path.join(root, relative));
        return {
            relative,
            tests: result.tests,
            suites: supportInstalled ? result.suites.filter((s) => s.depth >= 1) : [],
        };
    });

    if (!supportInstalled) {
        stdout.write('\n  Contexts are not listed, because ' + (host.supportFile || 'the Cypress support file') +
            ' does not import this package.\n  Add this line to it to pick contexts as well as specs:\n\n' +
            "    import 'cypress-pick/support'\n");
    }

    if (!stdin.isTTY) {
        stdout.write('\n  This needs an interactive terminal. Run Cypress directly instead, for example:\n\n' +
            '    npx cypress run --spec ' + files[0] + '\n\n');
        return 1;
    }

    const total = scanned.reduce((sum, s) => sum + s.tests, 0);
    const title = 'cypress-pick        ' + files.length + ' specs, ' + total + ' tests';
    const picked = await promptList(createState(scanned), { title, stdout, stdin });
    if (!picked) { stdout.write('\n  Nothing run.\n'); return 0; }
    const state = picked.state;

    const selection = buildSelection(toPickedSpecs(state));
    if (selection.specs.length === 0) {
        stdout.write('\n  Nothing was ticked, so nothing was run.\n');
        return 1;
    }

    for (const line of warnings(state)) stdout.write('\n  ' + line + '\n');

    // A project with no package.json of its own is unusual but possible, and it is
    // not a reason to stop: running Cypress directly still works.
    let hostPackage = {};
    try {
        hostPackage = require(path.join(root, 'package.json'));
    } catch (err) {
        hostPackage = {};
    }
    const scripts = runnableScripts(hostPackage);
    const outcome = scripts.length === 0
        ? { how: { kind: 'cypress' }, message: null }
        : await chooseHow(scripts, { stdout, stdin });
    if (!outcome) { stdout.write('\n  Nothing run.\n'); return 0; }
    if (outcome.message) stdout.write('\n  ' + outcome.message + '\n');
    if (!outcome.how) return 1;
    const how = outcome.how;

    const version = { cypressMajor: host.cypressMajor === null ? 16 : host.cypressMajor };
    if (how.kind === 'cypress') {
        const dropped = typedSpecNotice(options.passthrough, selection);
        if (dropped) stdout.write('\n  ' + dropped + '\n');
        return runCypress(composeCypressArgs(selection, version, options.passthrough), { cwd: root });
    }
    return runNpmScript(how.name, {
        cwd: root,
        env: buildEnv(selection, version),
        scripts: scripts.map((s) => s.name),
    });
}

module.exports = { main, parseArgs, composeCypressArgs, hasSpecFlag, decideHow, typedSpecNotice };
