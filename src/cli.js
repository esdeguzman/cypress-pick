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

// A second list, reusing the same widget, so the run mode is picked the same way the
// specs were. Running Cypress directly is always first because it needs no setup in
// the host project.
async function chooseHow(scripts, { stdout, stdin }) {
    const choices = [{ relative: 'run cypress directly', tests: 0, suites: [] }].concat(
        scripts.map((s) => ({ relative: 'npm run ' + s.name, tests: 0, suites: [] }))
    );
    const state = await promptList(createState(choices), {
        title: 'How should it run? Move to one, press space, then enter.',
        stdout,
        stdin,
    });
    if (!state) return null;
    const picked = state.specs.findIndex((s) => s.checked);
    if (picked <= 0) return { kind: 'cypress' };
    return { kind: 'script', name: scripts[picked - 1].name };
}

async function main(argv, { cwd = process.cwd(), stdout = process.stdout, stdin = process.stdin } = {}) {
    const options = parseArgs(argv);
    if (options.help) { stdout.write(HELP); return 0; }

    const root = options.cwd ? path.resolve(options.cwd) : cwd;
    const host = readHost(root);
    if (options.specPattern) host.specPattern = [options.specPattern];

    const files = findSpecs(root, host);
    if (files.length === 0) {
        stdout.write('\n  No spec files found under ' + host.specPattern.join(', ') + '\n');
        stdout.write('  Use --spec-pattern to say where they are.\n\n');
        return 1;
    }

    if (!host.configRead) {
        stdout.write('\n  The Cypress config could not be read, so the default pattern ' +
            DEFAULT_SPEC_PATTERN + ' was used.\n');
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
    const state = await promptList(createState(scanned), { title, stdout, stdin });
    if (!state) { stdout.write('\n  Nothing run.\n'); return 0; }

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
    const how = scripts.length === 0 ? { kind: 'cypress' } : await chooseHow(scripts, { stdout, stdin });
    if (!how) { stdout.write('\n  Nothing run.\n'); return 0; }

    const version = { cypressMajor: host.cypressMajor === null ? 16 : host.cypressMajor };
    if (how.kind === 'cypress') {
        return runCypress(buildArgs(selection, version).concat(options.passthrough), { cwd: root });
    }
    return runNpmScript(how.name, { cwd: root, env: buildEnv(selection, version) });
}

module.exports = { main, parseArgs };
