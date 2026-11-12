'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { composeCypressArgs, decideHow, typedSpecNotice, main } = require('../src/cli');

// Finding 2: a typed --spec must win over the picked one, the same rule
// runner.js already applies to the other run path. buildArgs always puts the
// picked spec as its first two entries, ['--spec', value], so dropping them is
// what "the typed one wins" means here.

test('with no typed spec flag, the picked one is kept', () => {
    const selection = { specs: ['picked.cy.js'], filter: {} };
    const args = composeCypressArgs(selection, { cypressMajor: 16 }, ['--browser', 'chrome']);
    assert.deepEqual(args, ['--spec', 'picked.cy.js', '--browser', 'chrome']);
});

test('a typed --spec replaces the picked one instead of sitting beside it', () => {
    const selection = { specs: ['picked.cy.js'], filter: {} };
    const args = composeCypressArgs(selection, { cypressMajor: 16 }, ['--spec', 'typed.cy.js']);
    assert.deepEqual(args, ['--spec', 'typed.cy.js']);
});

test('a typed -s replaces the picked spec too', () => {
    const selection = { specs: ['picked.cy.js'], filter: {} };
    const args = composeCypressArgs(selection, { cypressMajor: 16 }, ['-s', 'typed.cy.js']);
    assert.deepEqual(args, ['-s', 'typed.cy.js']);
});

test('a typed --spec=value replaces the picked spec too', () => {
    const selection = { specs: ['picked.cy.js'], filter: {} };
    const args = composeCypressArgs(selection, { cypressMajor: 16 }, ['--spec=typed.cy.js']);
    assert.deepEqual(args, ['--spec=typed.cy.js']);
});

test('a typed --spec still keeps the filter flag, dropping only the spec pair', () => {
    // Only the ['--spec', value] pair that buildArgs puts first is dropped. The
    // filter flag behind it is not part of that pair, so it stays, ahead of
    // whatever the person typed.
    const selection = { specs: ['picked.cy.js'], filter: { 'picked.cy.js': [['Root', 'A']] } };
    const args = composeCypressArgs(selection, { cypressMajor: 16 }, ['--spec', 'typed.cy.js']);
    assert.equal(args[0], '--expose');
    assert.equal(args[1].startsWith('cypressPick='), true);
    assert.deepEqual(args.slice(2), ['--spec', 'typed.cy.js']);
});

// Finding 3: ticking more than one run mode must refuse to run at all and say so,
// instead of picking the first ticked row without telling the person. Ticking none
// must say so too, rather than behaving exactly like a deliberate choice of "run
// cypress directly".

const scriptRow = (name) => ({ name });
const specRow = (checked) => ({ checked });

test('ticking exactly the cypress row runs cypress, with no message', () => {
    const state = { specs: [specRow(true), specRow(false)] };
    const outcome = decideHow(state, [scriptRow('headless')]);
    assert.deepEqual(outcome.how, { kind: 'cypress' });
    assert.equal(outcome.message, null);
});

test('ticking exactly one script row runs that script', () => {
    const state = { specs: [specRow(false), specRow(true)] };
    const outcome = decideHow(state, [scriptRow('headless')]);
    assert.deepEqual(outcome.how, { kind: 'script', name: 'headless' });
    assert.equal(outcome.message, null);
});

test('ticking nothing runs cypress, but says so instead of behaving the same as choosing it', () => {
    const state = { specs: [specRow(false), specRow(false)] };
    const outcome = decideHow(state, [scriptRow('headless')]);
    assert.deepEqual(outcome.how, { kind: 'cypress' });
    assert.equal(typeof outcome.message, 'string');
    assert.equal(outcome.message.length > 0, true);
});

test('ticking more than one row refuses instead of guessing which one was meant', () => {
    const state = { specs: [specRow(true), specRow(true)] };
    const outcome = decideHow(state, [scriptRow('headless')]);
    assert.equal(outcome.how, null);
    assert.equal(typeof outcome.message, 'string');
    assert.equal(outcome.message.length > 0, true);
});

// Finding I3. A typed spec wins, which is right, but the picked ones were thrown
// away without a word. The person sees a run of something they did not tick.

test('I3: a typed spec produces a line saying the ticked ones were not used', () => {
    const notice = typedSpecNotice(['--spec', 'typed.cy.js'], { specs: ['picked.cy.js'] });
    assert.equal(typeof notice, 'string');
    assert.match(notice, /typed\.cy\.js/);
    assert.match(notice, /picked\.cy\.js/);
});

test('I3: no typed spec means no line', () => {
    assert.equal(typedSpecNotice(['--browser', 'chrome'], { specs: ['picked.cy.js'] }), null);
});

test('I3: the short form and the equals form are noticed too', () => {
    assert.equal(typeof typedSpecNotice(['-s', 'typed.cy.js'], { specs: ['a'] }), 'string');
    assert.equal(typeof typedSpecNotice(['--spec=typed.cy.js'], { specs: ['a'] }), 'string');
});

// Finding I6. The notice about the config explains the pattern that the next line
// complains about, so it has to come first.

test('I6: the config notice is printed before the no-spec-files exit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cypick-cli-'));
    fs.writeFileSync(path.join(dir, 'cypress.config.js'), "throw new Error('deliberate failure for this test')");
    const written = [];
    const code = await main(['--cwd', dir], {
        stdout: { write: (text) => written.push(text) },
        stdin: { isTTY: false },
    });
    const output = written.join('');
    assert.equal(code, 1);
    assert.match(output, /config could not be read/);
    assert.match(output, /No spec files found/);
    assert.ok(output.indexOf('config could not be read') < output.indexOf('No spec files found'));
});

// The headless key runs Cypress and never draws the mode list. The project built
// here has a runnable script, so pressing enter instead would have drawn it.
// Cypress is not installed in a temporary folder, so the run stops there and the
// exit code is 1. The spec is ticked first, so that 1 can only have come from the
// Cypress path: the other way to get a 1 is the refusal for nothing ticked, and
// that message is checked for and must not be there.
//
// The "Cypress is not installed" line itself is not checked, because runCypress
// writes it to process.stdout rather than to the stdout passed in, so it never
// reaches the array below.

function fakeTty() {
    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    return stdin;
}

function tinyProject() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cypick-headless-'));
    fs.mkdirSync(path.join(dir, 'cypress', 'e2e'), { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'cypress.config.js'),
        "module.exports = { e2e: { specPattern: 'cypress/e2e/**/*.cy.js' } };\n"
    );
    fs.writeFileSync(
        path.join(dir, 'cypress', 'e2e', 'one.cy.js'),
        "describe('Root', () => { it('works', () => {}); });\n"
    );
    fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'tiny', scripts: { headless: 'cypress run' } })
    );
    return dir;
}

test('r runs cypress and never draws the mode list', async () => {
    const dir = tinyProject();
    const stdin = fakeTty();
    const written = [];
    const codePromise = main([], {
        cwd: dir,
        stdout: { write: (text) => written.push(text) },
        stdin,
    });

    await new Promise((resolve) => setImmediate(resolve)); // let the first draw happen
    stdin.write(' '); // tick the one spec
    stdin.write('r');

    const code = await codePromise;
    const output = written.join('');
    assert.ok(!output.includes('How should it run?'), 'the mode list was never drawn');
    assert.ok(!output.includes('Nothing was ticked'), 'the spec was ticked, so this is not the refusal');
    assert.equal(code, 1, 'the run reached Cypress, which is not installed in a temporary folder');
});

test('r with nothing ticked refuses, the same way enter does', async () => {
    const dir = tinyProject();
    const stdin = fakeTty();
    const written = [];
    const codePromise = main([], {
        cwd: dir,
        stdout: { write: (text) => written.push(text) },
        stdin,
    });

    await new Promise((resolve) => setImmediate(resolve));
    stdin.write('r'); // no tick first

    const code = await codePromise;
    assert.match(written.join(''), /Nothing was ticked, so nothing was run/);
    assert.equal(code, 1);
});
