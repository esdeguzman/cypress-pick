'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { lastRunPath, saveLastRun, loadLastRun, staleParts, describeLastRun } = require('../src/last-run');
const { main, parseArgs } = require('../src/cli');

const SPEC = 'cypress/e2e/one.cy.js';

function project() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cypick-last-'));
    fs.mkdirSync(path.join(dir, 'cypress', 'e2e'), { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'cypress.config.js'),
        "module.exports = { e2e: { specPattern: 'cypress/e2e/**/*.cy.js' } };\n"
    );
    fs.writeFileSync(
        path.join(dir, SPEC),
        "describe('Root', () => {\n  context('A', () => { it('a', () => {}); });\n" +
        "  context('B', () => { it('b', () => {}); });\n});\n"
    );
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'tiny', scripts: { e2e: 'cypress run' } }));
    return dir;
}

const whole = { selection: { specs: [SPEC], filter: {} }, how: { kind: 'cypress' }, passthrough: [] };

function capture() {
    const written = [];
    return { written, stdout: { write: (text) => written.push(text) } };
}

test('--last is read as an option, not passed through to Cypress', () => {
    const options = parseArgs(['--last', '--', '--browser', 'chrome']);
    assert.equal(options.last, true);
    assert.deepEqual(options.passthrough, ['--browser', 'chrome']);
});

test('a saved run loads back as it was saved', () => {
    const dir = project();
    assert.equal(saveLastRun(dir, whole), true);
    assert.deepEqual(loadLastRun(dir).run, whole);
});

test('with nothing saved, loading reports a problem instead of a run', () => {
    assert.match(loadLastRun(project()).problem, /no earlier run/);
});

test('a saved file in the wrong shape is not replayed', () => {
    const dir = project();
    fs.mkdirSync(path.dirname(lastRunPath(dir)), { recursive: true });
    fs.writeFileSync(lastRunPath(dir), JSON.stringify({ version: 1, selection: { specs: [] } }));
    assert.match(loadLastRun(dir).problem, /could not be read/);
});

test('a deleted spec is reported as stale', () => {
    const dir = project();
    assert.deepEqual(staleParts(dir, { specs: ['gone.cy.js'], filter: {} }), ['gone.cy.js no longer exists']);
});

test('a ticked context that no longer exists is reported, because it would match nothing', () => {
    const dir = project();
    const selection = { specs: [SPEC], filter: { [SPEC]: { include: [['Root', 'Renamed']], exclude: [] } } };
    assert.deepEqual(staleParts(dir, selection), [SPEC + ': context "Root > Renamed" no longer exists']);
});

test('an unticked context that has gone is ignored, since it was not going to run', () => {
    const dir = project();
    const selection = { specs: [SPEC], filter: { [SPEC]: { include: [['Root', 'A']], exclude: [['Root', 'Gone']] } } };
    assert.deepEqual(staleParts(dir, selection), []);
});

test('the description names the specs, the narrowed ones, the route and the flags', () => {
    const lines = describeLastRun({
        selection: { specs: [SPEC, 'b.cy.js'], filter: { [SPEC]: { include: [['Root', 'A']], exclude: [] } } },
        how: { kind: 'script', name: 'e2e' },
        passthrough: ['--browser', 'chrome'],
    });
    assert.deepEqual(lines, [
        'Replaying the last run, through npm run e2e:',
        '  ' + SPEC + '   some contexts',
        '  b.cy.js',
        '  with --browser chrome',
    ]);
});

test('main --last with nothing saved says so and exits 1, with no terminal needed', async () => {
    const out = capture();
    const code = await main(['--last'], { cwd: project(), stdout: out.stdout, stdin: { isTTY: false }, env: {} });
    assert.equal(code, 1);
    assert.match(out.written.join(''), /no earlier run/);
});

test('main --last replays without a terminal and reaches Cypress', async () => {
    // Cypress is not installed in a temporary folder, so reaching it ends in exit 1.
    // The description line shows the replay got past loading and the stale check.
    const dir = project();
    saveLastRun(dir, whole);
    const out = capture();
    const code = await main(['--last'], { cwd: dir, stdout: out.stdout, stdin: { isTTY: false }, env: {} });
    const output = out.written.join('');
    assert.match(output, /Replaying the last run, running Cypress directly/);
    assert.ok(!output.includes('interactive terminal'));
    assert.equal(code, 1);
});

test('flags typed with --last replace the saved ones', async () => {
    const dir = project();
    saveLastRun(dir, { ...whole, passthrough: ['--browser', 'firefox'] });
    const out = capture();
    await main(['--last', '--', '--browser', 'chrome'], { cwd: dir, stdout: out.stdout, stdin: { isTTY: false }, env: {} });
    const output = out.written.join('');
    assert.match(output, /with --browser chrome/);
    assert.ok(!output.includes('firefox'));
});

test('npm run pick --last works through the variable npm sets', async () => {
    const out = capture();
    await main([], { cwd: project(), stdout: out.stdout, stdin: { isTTY: false }, env: { npm_config_last: 'true' } });
    assert.match(out.written.join(''), /no earlier run/);
});

test('a stale run is refused before anything starts', async () => {
    const dir = project();
    saveLastRun(dir, whole);
    fs.unlinkSync(path.join(dir, SPEC));
    const out = capture();
    const code = await main(['--last'], { cwd: dir, stdout: out.stdout, stdin: { isTTY: false }, env: {} });
    assert.equal(code, 1);
    assert.match(out.written.join(''), /cannot be replayed[\s\S]*no longer exists/);
});

test('a picked run is saved, so --last can replay it', async () => {
    const dir = project();
    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    const out = capture();
    const codePromise = main([], { cwd: dir, stdout: out.stdout, stdin, env: {} });
    await new Promise((resolve) => setImmediate(resolve));
    stdin.write(' ');
    stdin.write('r');
    await codePromise;
    assert.deepEqual(loadLastRun(dir).run, whole);
});
