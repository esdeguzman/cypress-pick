'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('node:stream');
const { renderLines, promptList } = require('../src/checkbox-list');
const { createState, reduce, visibleRows } = require('../src/list-state');

// Same shape as test/list-state.test.js: two specs, one with a context the
// picker cannot tick because it is skipped.
const SCANNED = [
    {
        relative: 'cypress/e2e/a.cy.js',
        tests: 6,
        suites: [
            { title: 'A one', path: ['Root', 'A one'], depth: 1, tests: 2, modifier: null, readable: true },
            { title: 'A two', path: ['Root', 'A two'], depth: 1, tests: 3, modifier: null, readable: true },
            { title: 'A skipped', path: ['Root', 'A skipped'], depth: 1, tests: 1, modifier: 'skip', readable: true },
        ],
    },
    {
        relative: 'cypress/e2e/b.cy.js',
        tests: 4,
        suites: [
            { title: 'B one', path: ['Root', 'B one'], depth: 1, tests: 4, modifier: null, readable: true },
        ],
    },
];

// renderLines is a plain function, so these tests call it directly with no
// terminal and no promise involved.

test('a collapsed list shows one row per spec, no contexts', () => {
    const lines = renderLines(createState(SCANNED), { title: 'pick a spec' });
    assert.ok(lines.some((l) => l.includes('cypress/e2e/a.cy.js')));
    assert.ok(lines.some((l) => l.includes('cypress/e2e/b.cy.js')));
    assert.ok(!lines.some((l) => l.includes('A one')));
    assert.ok(!lines.some((l) => l.includes('B one')));
});

test('opening a spec shows its contexts indented beneath it', () => {
    const state = reduce(createState(SCANNED), 'open');
    const lines = renderLines(state, { title: 'pick a spec' });
    const specLine = lines.find((l) => l.includes('cypress/e2e/a.cy.js'));
    const contextLine = lines.find((l) => l.includes('A one'));
    assert.ok(specLine, 'the spec row is still there once open');
    assert.ok(contextLine, 'the context row is drawn once open');
    // The context's label starts two columns further right than the spec's,
    // which is what depth: 1 on the context and depth: 0 on the spec means.
    const specCol = specLine.indexOf('cypress/e2e/a.cy.js');
    const contextCol = contextLine.indexOf('A one');
    assert.equal(contextCol, specCol + 2);
});

test('a whole spec shows [x], a partly ticked one shows [~], an untouched one shows [ ]', () => {
    let state = reduce(createState(SCANNED), 'toggle'); // ticks spec a, whole
    let lines = renderLines(state, { title: 't' });
    assert.ok(lines.find((l) => l.includes('[x]') && l.includes('cypress/e2e/a.cy.js')));
    assert.ok(lines.find((l) => l.includes('[ ]') && l.includes('cypress/e2e/b.cy.js')));

    state = reduce(state, 'open');
    state = reduce(state, 'down'); // cursor onto context "A one"
    state = reduce(state, 'toggle'); // untick it, spec a is now partial
    lines = renderLines(state, { title: 't' });
    assert.ok(lines.find((l) => l.includes('[~]') && l.includes('cypress/e2e/a.cy.js')));
});

test('a skipped context is shown as not tickable, with its note', () => {
    const state = reduce(createState(SCANNED), 'open');
    const lines = renderLines(state, { title: 't' });
    const skippedLine = lines.find((l) => l.includes('A skipped'));
    assert.ok(skippedLine);
    assert.ok(skippedLine.includes(' - '), 'a context that cannot be ticked has no checkbox, just a dash');
    assert.ok(skippedLine.includes('skipped'), 'the reason it cannot be ticked is printed next to it');
});

test('the cursor marker sits on the row the cursor is actually on', () => {
    let state = createState(SCANNED);
    let lines = renderLines(state, { title: 't' });
    const bodyStart = 3; // the three header lines: blank, title, blank
    assert.equal(lines[bodyStart][0], '>', 'row 0 is marked at the start');
    assert.equal(lines[bodyStart + 1][0], ' ', 'row 1 is not marked yet');

    state = reduce(state, 'down');
    lines = renderLines(state, { title: 't' });
    assert.equal(lines[bodyStart][0], ' ', 'the marker left row 0');
    assert.equal(lines[bodyStart + 1][0], '>', 'the marker moved to row 1');
});

// promptList reads real keys from a stream. A PassThrough with isTTY set to
// false stands in for the terminal: setRawMode is never reached, so nothing
// here needs a real tty. Each helper collects what promptList wrote so the
// cursor handling can be checked too.
function fakeTerminal() {
    const stdin = new PassThrough();
    stdin.isTTY = false;
    const written = [];
    const stdout = { write: (chunk) => { written.push(chunk); return true; } };
    return { stdin, stdout, written };
}

test('moving down and ticking with space checks the second spec', async () => {
    const { stdin, stdout } = fakeTerminal();
    const resultPromise = promptList(createState(SCANNED), { title: 't', stdin, stdout });

    stdin.write('\u001b[B'); // cursor from spec a to spec b
    stdin.write(' '); // tick spec b
    stdin.write('\r'); // accept

    const state = await resultPromise;
    assert.ok(state, 'enter resolves with the state, not null');
    assert.equal(state.cursor, 1);
    const rows = visibleRows(state);
    assert.equal(rows[0].mark, ' ', 'spec a was never touched');
    assert.equal(rows[1].mark, 'x', 'spec b is ticked');
});

test('opening a spec with the right arrow then ticking one context', async () => {
    const { stdin, stdout } = fakeTerminal();
    const resultPromise = promptList(createState(SCANNED), { title: 't', stdin, stdout });

    stdin.write('\u001b[C'); // open spec a, cursor stays on the spec row
    stdin.write('\u001b[B'); // onto context "A one"
    stdin.write(' '); // tick it
    stdin.write('\n'); // accept, the other accept key

    const state = await resultPromise;
    assert.ok(state);
    const rows = visibleRows(state);
    assert.equal(rows[0].mark, '~', 'spec a is partial: one of its two tickable contexts is on');
    assert.equal(rows[1].mark, 'x', '"A one" is ticked');
    assert.equal(rows[2].mark, ' ', '"A two" was never touched');
});

test('q quits and resolves to null', async () => {
    const { stdin, stdout } = fakeTerminal();
    const resultPromise = promptList(createState(SCANNED), { title: 't', stdin, stdout });
    stdin.write('q');
    const state = await resultPromise;
    assert.equal(state, null);
});

test('Ctrl+C quits and resolves to null', async () => {
    const { stdin, stdout } = fakeTerminal();
    const resultPromise = promptList(createState(SCANNED), { title: 't', stdin, stdout });
    stdin.write('\u0003');
    const state = await resultPromise;
    assert.equal(state, null);
});

test('enter resolves with the state as it stands', async () => {
    const { stdin, stdout } = fakeTerminal();
    const resultPromise = promptList(createState(SCANNED), { title: 't', stdin, stdout });
    stdin.write(' '); // tick spec a first, so the resolved state is not just the start state
    stdin.write('\r');
    const state = await resultPromise;
    assert.ok(state);
    assert.equal(visibleRows(state)[0].mark, 'x');
});

test('a ticks everything and n unticks everything', async () => {
    const { stdin, stdout } = fakeTerminal();
    const resultPromise = promptList(createState(SCANNED), { title: 't', stdin, stdout });
    stdin.write('a');
    stdin.write('\r');
    const tickedAll = await resultPromise;
    assert.deepEqual(visibleRows(tickedAll).map((r) => r.mark), ['x', 'x']);

    const { stdin: stdin2, stdout: stdout2 } = fakeTerminal();
    const resultPromise2 = promptList(createState(SCANNED), { title: 't', stdin: stdin2, stdout: stdout2 });
    stdin2.write('a');
    stdin2.write('n');
    stdin2.write('\r');
    const untickedAll = await resultPromise2;
    assert.deepEqual(visibleRows(untickedAll).map((r) => r.mark), [' ', ' ']);
});

// The screen is rewound by exactly the number of lines the previous draw wrote, so a
// run that leaves copies on screen shows up here as the wrong rewind count rather than
// only in a person's terminal.
test('a redraw rewinds the screen by exactly the number of lines drawn last time', async () => {
    const { stdin, stdout, written } = fakeTerminal();
    const resultPromise = promptList(createState(SCANNED), { title: 't', stdin, stdout });
    stdin.write('\u001b[B'); // forces a second draw
    stdin.write('\r');
    await resultPromise;

    const firstDraw = written[1]; // written[0] is the initial hide-cursor escape
    const linesDrawn = firstDraw.split('\n').length - 1; // trailing \n leaves one empty entry
    const secondDraw = written[2];
    assert.ok(
        secondDraw.startsWith('\u001b[' + linesDrawn + 'A'),
        'the rewind count must match how many lines the previous draw wrote'
    );
});

test('an unknown key changes nothing', async () => {
    const { stdin, stdout } = fakeTerminal();
    const resultPromise = promptList(createState(SCANNED), { title: 't', stdin, stdout });
    stdin.write('z'); // not in KEYS, not a quit key, not an accept key
    stdin.write('\r');
    const state = await resultPromise;
    assert.ok(state);
    assert.equal(state.cursor, 0);
    assert.equal(visibleRows(state)[0].mark, ' ');
    assert.equal(visibleRows(state)[1].mark, ' ');
});

// A terminal left with no cursor is the failure this protects against: the
// code hides the cursor with one escape sequence as soon as it starts, and
// must show it again with the matching sequence on every way out.
test('the cursor is shown again after quitting with q', async () => {
    const { stdin, stdout, written } = fakeTerminal();
    const resultPromise = promptList(createState(SCANNED), { title: 't', stdin, stdout });
    stdin.write('q');
    await resultPromise;
    assert.equal(written[written.length - 1], '\u001b[?25h');
});

test('the cursor is shown again after accepting with enter', async () => {
    const { stdin, stdout, written } = fakeTerminal();
    const resultPromise = promptList(createState(SCANNED), { title: 't', stdin, stdout });
    stdin.write('\r');
    await resultPromise;
    assert.equal(written[written.length - 1], '\u001b[?25h');
});

test('the cursor is shown again after Ctrl+C', async () => {
    const { stdin, stdout, written } = fakeTerminal();
    const resultPromise = promptList(createState(SCANNED), { title: 't', stdin, stdout });
    stdin.write('\u0003');
    await resultPromise;
    assert.equal(written[written.length - 1], '\u001b[?25h');
});
