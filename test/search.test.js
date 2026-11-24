'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('node:stream');
const { terms, scoreTerm } = require('../src/fuzzy');
const { findMatches } = require('../src/search');
const { createState, visibleRows, reduce, toPickedSpecs, searchSummary } = require('../src/list-state');
const { renderLines, promptList } = require('../src/checkbox-list');

const suite = (title, extra = {}) => ({
    title, path: ['Root', title], depth: 1, tests: 1, modifier: null, readable: true, ...extra,
});
const spec = (name, suites = []) => ({ relative: 'cypress/e2e/' + name + '.cy.js', tests: 2, suites });

const SCANNED = [
    spec('audit-logs', [suite('Filters'), suite('Exports')]),
    spec('confirmed-bugs', [suite('Sprint 4')]),
    spec('forecasted-cost', [suite('Update Pricing'), suite('Status gating')]),
    spec('login-page', [suite('Expired session'), suite('Wrong password')]),
    spec('project-approvals'),
];

const name = (row) => row.label.replace('cypress/e2e/', '').replace('.cy.js', '');
const labels = (state) => visibleRows(state).map(name);
const under = (state) => name(visibleRows(state)[state.cursor]);
const start = () => createState(SCANNED, { tickedFirst: true });
const search = (state, query) => reduce(reduce(state, 'search-start'), 'search-type', query);
const press = (state, ...keys) => keys.reduce((s, key) => reduce(s, key), state);

// Moves the cursor to a row by its name, then ticks it.
function tick(state, label) {
    const at = labels(state).indexOf(label);
    assert.notEqual(at, -1, label + ' is not in the list');
    return reduce({ ...state, cursor: at }, 'toggle');
}

const found = (query, scanned = SCANNED) => {
    const specs = createState(scanned).specs;
    return Array.from(findMatches(specs, query).keys()).map((i) => name({ label: specs[i].relative }));
};

// ---- matching

test('terms splits on any space and ignores case', () => {
    assert.deepEqual(terms('  Login   PAGE '), ['login', 'page']);
    assert.deepEqual(terms('   '), []);
});

test('the four ways of matching rank in the order given', () => {
    const typed = scoreTerm('login', 'login-page', { loose: true });
    const starts = scoreTerm('logpag', 'login-page', { loose: true });
    const typo = scoreTerm('lgoin', 'login-page', { loose: true });
    const inOrder = scoreTerm('lgnpg', 'login-page', { loose: true });
    assert.ok(typed > starts && starts > typo && typo > inOrder && inOrder > 0);
});

test('a whole word beats the start of a word, which beats the middle of one', () => {
    assert.ok(scoreTerm('log', 'log out') > scoreTerm('log', 'login'));
    assert.ok(scoreTerm('log', 'login') > scoreTerm('log', 'catalog'));
});

test('a missing, extra, wrong or swapped letter is a typo, and still matches', () => {
    for (const term of ['logn', 'logiin', 'lofin', 'lgoin']) {
        assert.ok(scoreTerm(term, 'login page') > 0, term);
    }
    assert.equal(scoreTerm('lgo', 'login page'), 0, 'three letters are too few to allow a slip');
    assert.equal(scoreTerm('lxgzn', 'login page'), 0, 'two slips in five letters are too many');
});

test('letters merely in order do not match a context title', () => {
    assert.equal(scoreTerm('sgt', 'Status gating'), 0);
    assert.ok(scoreTerm('stagat', 'Status gating') > 0, 'the starts of its words do');
});

test('a capital inside a word starts a new one', () => {
    assert.ok(scoreTerm('usepro', 'userProfile') > 0);
});

test('a spec is found by name, by abbreviation and by typo', () => {
    assert.deepEqual(found('login'), ['login-page']);
    assert.deepEqual(found('audlog'), ['audit-logs']);
    assert.deepEqual(found('cnfbg'), ['confirmed-bugs']);
    assert.deepEqual(found('aprpovals'), ['project-approvals']);
    assert.deepEqual(found('zzzz'), []);
});

test('the folders every spec shares, and the ending, find nothing on their own', () => {
    assert.deepEqual(found('cypress'), []);
    assert.deepEqual(found('cy'), []);
    assert.deepEqual(found('js'), []);
});

test('a folder that only some specs are in does find them', () => {
    const scanned = [spec('admin/users'), spec('admin/roles'), spec('shop/cart')];
    assert.deepEqual(found('admin', scanned), ['admin/users', 'admin/roles']);
});

test('a pasted path finds its spec', () => {
    assert.deepEqual(found('cypress/e2e/login-page.cy.js'), ['login-page']);
});

test('every term has to be found, across a spec name and a context title', () => {
    assert.deepEqual(found('login expired'), ['login-page']);
    assert.deepEqual(found('login pricing'), []);
});

test('a context whose title could not be read is passed over', () => {
    const scanned = [spec('a', [suite(null, { path: ['Root', null], readable: false })]), spec('b')];
    assert.deepEqual(found('root', scanned), []);
});

// ---- the list while searching

test('only the results are listed, best first', () => {
    const scanned = [spec('catalog'), spec('log'), spec('login'), spec('other')];
    const state = search(createState(scanned, { tickedFirst: true }), 'log');
    assert.deepEqual(labels(state), ['log', 'login', 'catalog']);
});

test('a context that is found is listed under its spec, with the cursor on it', () => {
    const state = search(start(), 'pricing');
    assert.deepEqual(labels(state), ['forecasted-cost', 'Update Pricing']);
    assert.equal(under(state), 'Update Pricing');

    const picked = toPickedSpecs(reduce(state, 'toggle'))[2];
    assert.deepEqual(picked.suites.map((x) => x.checked), [true, false], 'the rest of the spec is not ticked');
});

test('the contexts holding a found one are listed too', () => {
    const scanned = [spec('a', [
        suite('Outer'),
        { ...suite('Inner thing'), path: ['Root', 'Outer', 'Inner thing'], depth: 2 },
        suite('Unrelated'),
    ])];
    assert.deepEqual(labels(search(createState(scanned), 'inner')), ['a', 'Outer', 'Inner thing']);
});

test('opening a result lists all of its contexts, closing goes back to the found ones', () => {
    let state = press(search(start(), 'pricing'), 'up', 'open');
    assert.deepEqual(labels(state), ['forecasted-cost', 'Update Pricing', 'Status gating']);
    state = reduce(state, 'close');
    assert.deepEqual(labels(state), ['forecasted-cost', 'Update Pricing']);
});

test('ticked specs stay listed during a search, above the results', () => {
    const state = search(tick(start(), 'audit-logs'), 'login');
    assert.deepEqual(labels(state), ['audit-logs', 'login-page']);
    assert.equal(under(state), 'login-page', 'the cursor is on the result, not on the ticked spec above it');
});

test('ticked specs can be hidden during a search, and shown again', () => {
    let state = search(tick(start(), 'audit-logs'), 'login');
    state = reduce(state, 'search-ticked');
    assert.deepEqual(labels(state), ['login-page']);
    assert.deepEqual(searchSummary(state), { found: 1, tickedShown: 0, tickedHidden: 1 });
    state = reduce(state, 'search-ticked');
    assert.deepEqual(labels(state), ['audit-logs', 'login-page']);
});

test('a result ticked while the ticked are hidden leaves the list and is still picked', () => {
    let state = reduce(search(start(), 'login'), 'search-ticked');
    state = reduce(state, 'toggle');
    assert.deepEqual(labels(state), []);
    assert.equal(state.cursor, 0);
    assert.ok(toPickedSpecs(state)[3].checked);
});

test('a partly ticked result is not hidden, because it has contexts left to tick', () => {
    let state = reduce(search(start(), 'pricing'), 'search-ticked');
    state = reduce(state, 'toggle');
    assert.deepEqual(labels(state), ['forecasted-cost', 'Update Pricing']);
    assert.equal(visibleRows(state)[0].mark, '~');
});

test('hiding the ticked has no effect outside a search', () => {
    let state = reduce(search(tick(start(), 'audit-logs'), 'login'), 'search-ticked');
    state = reduce(state, 'search-end');
    assert.equal(labels(state).length, SCANNED.length);
    assert.equal(reduce(start(), 'search-ticked').search.hideTicked, false);
});

test('all and none act on the results only', () => {
    let state = search(tick(start(), 'audit-logs'), 'login');
    state = reduce(state, 'all');
    assert.deepEqual(toPickedSpecs(state).map((s) => s.checked), [true, false, false, true, false]);
    state = reduce(state, 'none');
    assert.deepEqual(toPickedSpecs(state).map((s) => s.checked), [true, false, false, false, false]);
});

test('ending a search lists everything again, with the cursor on the same row', () => {
    const state = reduce(search(start(), 'login'), 'search-end');
    assert.equal(labels(state).length, SCANNED.length);
    assert.equal(under(state), 'login-page');
});

test('ending a search from a context goes to its spec, which is closed again', () => {
    const state = reduce(search(start(), 'pricing'), 'search-end');
    assert.equal(under(state), 'forecasted-cost');
});

test('backspace edits the search, then leaves it', () => {
    let state = search(start(), 'lo');
    state = reduce(state, 'search-backspace');
    assert.equal(state.search.query, 'l');
    state = reduce(state, 'search-backspace');
    assert.equal(state.search.query, '');
    assert.ok(state.search.typing);
    state = reduce(state, 'search-backspace');
    assert.ok(!state.search.typing);
});

test('a search that finds nothing is safe to move and tick in', () => {
    const state = press(search(start(), 'zzzz'), 'down', 'toggle', 'open', 'close', 'all', 'none', 'up', 'search-ticked');
    assert.deepEqual(labels(state), []);
    assert.equal(state.cursor, 0);
    assert.ok(toPickedSpecs(state).every((s) => !s.checked));
});

// ---- ticked specs first

test('a ticked spec moves above the rest, and back when unticked', () => {
    let state = tick(start(), 'login-page');
    assert.equal(labels(state)[0], 'login-page');
    state = tick(state, 'audit-logs');
    assert.deepEqual(labels(state).slice(0, 2), ['audit-logs', 'login-page'], 'they keep the order of the list');
    state = tick(tick(state, 'login-page'), 'audit-logs');
    assert.deepEqual(labels(state), labels(start()));
});

test('ticking a context moves its spec up, and the cursor stays on the context', () => {
    let state = reduce({ ...start(), cursor: 3 }, 'open');
    state = tick(state, 'Wrong password');
    assert.deepEqual(labels(state).slice(0, 3), ['login-page', 'Expired session', 'Wrong password']);
    assert.equal(under(state), 'Wrong password');
});

test('when a ticked spec moves away the cursor goes to the next one, so they can be ticked in a row', () => {
    const state = press(start(), 'down', 'down', 'toggle', 'toggle');
    assert.deepEqual(labels(state).slice(0, 2), ['forecasted-cost', 'login-page']);
    assert.equal(under(state), 'project-approvals');
});

test('ticking the last spec leaves the cursor on the one before it', () => {
    const state = tick(start(), 'project-approvals');
    assert.equal(under(state), 'login-page');
});

test('moving up is for drawing only: what runs keeps its order', () => {
    const state = tick(start(), 'login-page');
    assert.deepEqual(toPickedSpecs(state).map((s) => s.relative), SCANNED.map((s) => s.relative));
});

test('the list keeps its order unless it was asked to move ticked specs up', () => {
    const state = reduce({ ...createState(SCANNED), cursor: 3 }, 'toggle');
    assert.deepEqual(labels(state), labels(createState(SCANNED)));
    assert.equal(under(state), 'login-page');
});

test('space on the row saying a spec has no contexts does nothing', () => {
    const state = press({ ...start(), cursor: 4 }, 'open', 'down');
    assert.equal(visibleRows(state)[state.cursor].kind, 'note');
    assert.doesNotThrow(() => reduce(state, 'toggle'));
});

// ---- drawing

const MANY = Array.from({ length: 200 }, (_, i) => spec('spec-' + i));

test('a long list never takes more lines than the terminal has', () => {
    const heights = Array.from({ length: 48 }, (_, i) => i + 3);
    for (const height of heights) {
        for (const cursor of [0, 100, 199, 'searching']) {
            const state = cursor === 'searching'
                ? search(createState(MANY, { tickedFirst: true }), 'spec')
                : { ...createState(MANY), cursor };
            const lines = renderLines(state, { title: 't', height, columns: 80, allowSearch: true });
            assert.ok(lines.length < height, lines.length + ' lines in ' + height);
            assert.ok(lines.some((l) => l.startsWith('>')), 'the row under the cursor is in view');
        }
    }
});

test('a list that does not fit says how much is out of sight', () => {
    const at = (cursor) => renderLines({ ...createState(MANY), cursor }, { title: 't', height: 24 }).join('\n');
    assert.ok(!at(0).includes('more above') && at(0).includes('more below'));
    assert.ok(at(100).includes('more above') && at(100).includes('more below'));
    assert.ok(at(199).includes('more above') && !at(199).includes('more below'));
});

test('a short terminal keeps the title or the search, and three rows where it can', () => {
    const draw = (state) => renderLines(state, { title: 'the title', height: 8, columns: 80 });
    const isRow = (line) => /^[> ] \[/.test(line);
    const plain = draw(createState(MANY));
    assert.match(plain[0], /the title/);
    assert.equal(plain.filter(isRow).length, 3);
    const searching = draw(search(createState(MANY), 'spec'));
    assert.match(searching[0], /search: spec_/);
    assert.equal(searching.filter(isRow).length, 3);
});

test('a title written over several lines is drawn on one', () => {
    const state = reduce(createState([spec('a', [suite('one\n\ttwo')])]), 'open');
    const lines = renderLines(state, { title: 't' });
    assert.ok(lines.some((l) => l.includes('one two')));
    assert.ok(lines.every((l) => !l.includes('\n')));
});

test('a list that fits is drawn whole, and no line reaches the edge of the terminal', () => {
    const lines = renderLines(search(start(), 'login'), { title: 't', height: 24, columns: 40 });
    assert.ok(!lines.join('\n').includes('more '));
    assert.ok(lines.every((l) => l.length < 40));
});

test('the search line shows the text, what was found, and the ticked', () => {
    let state = search(tick(start(), 'audit-logs'), 'login');
    const line = () => renderLines(state, { title: 't' }).find((l) => l.startsWith('  search:'));
    assert.equal(line(), '  search: login_    1 spec found, 1 ticked shown');
    state = press(state, 'search-ticked', 'search-accept');
    assert.equal(line(), '  search: login    1 spec found, 1 ticked hidden');
    state = search(start(), 'zzzz');
    assert.match(line(), /nothing found/);
});

test('the footer names the search key only when search is on offer', () => {
    assert.ok(renderLines(start(), { title: 't', allowSearch: true }).some((l) => l.includes('/ search')));
    assert.ok(!renderLines(start(), { title: 't' }).some((l) => l.includes('/ search')));
});

test('no footer is cut off in a terminal 80 wide', () => {
    const typing = search(start(), 'login');
    for (const state of [start(), typing, reduce(typing, 'search-accept')]) {
        const options = { title: 't', allowSearch: true, allowHeadless: true };
        assert.deepEqual(renderLines(state, { ...options, columns: 80 }).slice(-3), renderLines(state, options).slice(-3));
    }
});

// ---- keys

function open(options = {}) {
    const stdin = new PassThrough();
    stdin.isTTY = false;
    const written = [];
    const stdout = { write: (text) => { written.push(text); return true; } };
    const result = promptList(start(), { title: 't', stdin, stdout, allowSearch: true, allowHeadless: true, ...options });
    const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
    const send = async (...chunks) => {
        for (const chunk of chunks) { stdin.write(chunk); await settle(); }
    };
    return { send, settle, result, lastDraw: () => written[written.length - 1], all: () => written.join('') };
}

const checked = (picked) => toPickedSpecs(picked.state).map((s) => s.checked);

test('letters that are keys elsewhere are text while typing, q and r and n among them', async () => {
    const { send, result, lastDraw } = open();
    await send('/', 'q', 'r', 'n', 'a', ' ', 'h', '/');
    assert.match(lastDraw(), /search: qrna h\/_/);
    await send('\u0003');
    assert.equal(await result, null, 'Ctrl+C still quits');
});

test('tab ticks while typing, enter ends the typing, and a second enter runs', async () => {
    const { send, result } = open();
    await send('/', 'l', 'o', 'g', 'i', 'n', '\t', '\r', '\r');
    const picked = await result;
    assert.equal(picked.accept, 'ask');
    assert.deepEqual(checked(picked), [false, false, false, true, false]);
});

test('after the typing, space ticks and r runs, with the search still on', async () => {
    const { send, result } = open();
    await send('/', 'login', '\r', ' ', 'r');
    const picked = await result;
    assert.equal(picked.accept, 'headless');
    assert.deepEqual(checked(picked), [false, false, false, true, false]);
});

test('a pasted search is taken whole, and enter in it does not run anything', async () => {
    const { send, result, lastDraw } = open();
    await send('/login\r\r');
    assert.match(lastDraw(), /search: login {4}1 spec found/);
    await send('q');
    assert.equal(await result, null);
});

test('shift+tab hides the ticked, both while typing and after', async () => {
    const { send, result, lastDraw } = open();
    await send(' ', '/', 'login', '\u001b[Z');
    assert.match(lastDraw(), /1 ticked hidden/);
    await send('\r', '\u001b[Z');
    assert.match(lastDraw(), /1 ticked shown/);
    await send('q');
    await result;
});

test('escape on its own ends the search', async () => {
    const { send, settle, result, lastDraw } = open();
    await send('/', 'login', '\u001b');
    await settle(200);
    assert.doesNotMatch(lastDraw(), /search: /);
    assert.match(lastDraw(), /project-approvals/);
    await send('q');
    assert.equal(await result, null);
});

test('an arrow key split after its first byte does not end the search', async () => {
    const { send, settle, result, lastDraw } = open();
    await send('/', 'o', '\u001b', '[B');
    await settle(200);
    assert.match(lastDraw(), /search: o_/);
    await send('\u0003');
    await result;
});

test('line wrapping is off while the list is up, and on again after', async () => {
    const { send, result, all } = open();
    await send('q');
    await result;
    const output = all();
    assert.ok(output.indexOf('\u001b[?7l') !== -1);
    assert.ok(output.lastIndexOf('\u001b[?7h') > output.lastIndexOf('\u001b[?7l'));
});

test('a list without search ignores the search key', async () => {
    const { send, result, lastDraw } = open({ allowSearch: false });
    await send('/', 'q');
    assert.equal(await result, null, 'q quit, so it was not typed into a search');
    assert.doesNotMatch(lastDraw(), /search: /);
});
