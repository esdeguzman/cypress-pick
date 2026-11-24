'use strict';

const { findMatches } = require('./search');

// Everything about the list that does not need a terminal. The drawing lives in
// src/checkbox-list.js, which calls into here for every key. Keeping the two apart
// is what makes the behaviour testable.

// A context that cannot be ticked is one the picker could not honour: a skipped one
// will not run whatever is asked, and one whose title could not be read cannot be
// named on the command line.
//
// `blockedBy` carries the same answer down to the contexts inside one of those. A
// context inside an unreadable one has the gap in its own title path, so asking for
// it by name could never match anything at run time. Before this, such a context
// was offered, ticked, and then nothing ran at all.
function noteFor(suite) {
    if (suite.blockedBy === 'skip') return 'inside a skipped context';
    if (suite.blockedBy === 'unreadable') return 'inside a context whose title cannot be read';
    if (suite.modifier === 'skip') return 'skipped';
    if (!suite.readable) return 'title cannot be read';
    if (suite.modifier === 'only') return 'only';
    return null;
}

// True when `path` sits inside `maybeParent`, rather than being it.
function isInside(path, maybeParent) {
    if (path.length <= maybeParent.length) return false;
    for (let i = 0; i < maybeParent.length; i += 1) {
        if (path[i] !== maybeParent[i]) return false;
    }
    return true;
}

function selectableSuite(suite) {
    return suite.modifier !== 'skip' && suite.readable && !suite.blockedBy;
}

// tickedFirst draws the ticked specs above the rest. It changes the drawing only:
// `specs` keeps its own order, so what runs, and in what order, does not change.
function createState(scannedSpecs, { tickedFirst = false } = {}) {
    return {
        cursor: 0,
        tickedFirst,
        search: { typing: false, query: '', hideTicked: false, matches: new Map() },
        specs: scannedSpecs.map((s) => ({
            relative: s.relative,
            tests: s.tests,
            open: false,
            checked: false,
            // Markers the picker cannot override. Mocha decides what a file with an
            // `only` in it runs, so these are warned about rather than filtered.
            onlySuites: s.onlySuites || [],
            onlyTests: s.onlyTests || 0,
            suites: s.suites.map((x) => ({
                title: x.title,
                path: x.path,
                depth: x.depth,
                tests: x.tests,
                modifier: x.modifier,
                readable: x.readable,
                blockedBy: x.blockedBy || null,
                selectable: selectableSuite(x),
                note: noteFor(x),
                checked: false,
            })),
        })),
    };
}

// True when anything in the file carries `only`, wherever it sits: on the outermost
// suite, on a context, or on a single test. All three decide what runs instead of
// this package, and the first and last were missed before.
function carriesOnly(spec) {
    return spec.onlySuites.length > 0 || spec.onlyTests > 0 || spec.suites.some((x) => x.modifier === 'only');
}

function clone(state) {
    return {
        cursor: state.cursor,
        tickedFirst: state.tickedFirst,
        // The matches are replaced whole when the query changes and never edited, so
        // the copy can share them.
        search: { ...state.search },
        specs: state.specs.map((s) => ({ ...s, suites: s.suites.map((x) => ({ ...x })) })),
    };
}

function markFor(spec) {
    const selectable = spec.suites.filter((x) => x.selectable);
    if (!spec.checked) return ' ';
    if (selectable.length === 0) return 'x';
    const ticked = selectable.filter((x) => x.checked).length;
    if (ticked === selectable.length) return 'x';
    return '~';
}

function isSearching(state) {
    return state.search.query.trim() !== '';
}

// Only a spec ticked whole can be hidden. A partly ticked one still has contexts
// left to tick, and hiding it would take it away from someone halfway through it.
function isHidden(state, specIndex) {
    return state.search.hideTicked && markFor(state.specs[specIndex]) === 'x';
}

// The specs that are drawn, in the order they are drawn. While searching, that is
// the results plus whatever is ticked, or only the results not yet ticked whole when
// the ticked ones are hidden.
function shownSpecs(state) {
    const all = state.specs.map((_, i) => i);
    const ticked = (i) => state.specs[i].checked;

    if (!isSearching(state)) {
        if (!state.tickedFirst) return all;
        return all.filter(ticked).concat(all.filter((i) => !ticked(i)));
    }

    const { matches, hideTicked } = state.search;
    const shown = all.filter((i) => (matches.has(i) && !isHidden(state, i)) || (ticked(i) && !hideTicked));
    const results = shown
        .filter((i) => !ticked(i))
        .sort((x, y) => matches.get(y).score - matches.get(x).score || x - y);
    return shown.filter(ticked).concat(results);
}

// The counts shown beside the search.
function searchSummary(state) {
    const shown = new Set(shownSpecs(state));
    const ticked = state.specs.map((_, i) => i).filter((i) => state.specs[i].checked);
    return {
        found: state.search.matches.size,
        tickedShown: ticked.filter((i) => shown.has(i)).length,
        tickedHidden: ticked.filter((i) => !shown.has(i)).length,
    };
}

// An opened spec shows every context, as it does with no search. One that is not
// opened shows only the contexts the search found.
function shownSuites(state, specIndex) {
    const spec = state.specs[specIndex];
    const all = spec.suites.map((_, i) => i);
    if (spec.open) return all;
    const match = isSearching(state) ? state.search.matches.get(specIndex) : null;
    return match ? all.filter((i) => match.suites.has(i)) : [];
}

function visibleRows(state) {
    const rows = [];
    shownSpecs(state).forEach((specIndex) => {
        const spec = state.specs[specIndex];
        rows.push({
            kind: 'spec',
            specIndex,
            suiteIndex: -1,
            depth: 0,
            label: spec.relative,
            mark: markFor(spec),
            selectable: true,
            note: carriesOnly(spec) ? 'only' : null,
            tests: spec.tests,
            open: spec.open,
        });
        // Opening a spec that has nothing to tick used to show nothing at all, which
        // reads as the picker having failed. Say why instead.
        if (spec.open && spec.suites.length === 0) {
            rows.push({
                kind: 'note',
                specIndex,
                suiteIndex: -1,
                depth: 1,
                label: 'no contexts in this spec, it can only be ticked whole',
                mark: ' ',
                selectable: false,
                note: null,
                tests: 0,
                open: false,
            });
            return;
        }
        shownSuites(state, specIndex).forEach((suiteIndex) => {
            const suite = spec.suites[suiteIndex];
            rows.push({
                kind: 'suite',
                specIndex,
                suiteIndex,
                depth: suite.depth,
                label: suite.title === null ? '(title built at run time)' : suite.title,
                mark: suite.checked ? 'x' : ' ',
                selectable: suite.selectable,
                note: suite.note,
                tests: suite.tests,
                open: false,
            });
        });
    });
    return rows;
}

// Ticking a context implies its spec is in the run. Unticking the last one takes the
// spec out, which is what makes "untick everything" mean "do not run this spec".
function syncSpecFromSuites(spec) {
    const selectable = spec.suites.filter((x) => x.selectable);
    if (selectable.length === 0) return;
    spec.checked = selectable.some((x) => x.checked);
}

function setSpec(spec, checked) {
    spec.checked = checked;
    for (const suite of spec.suites) {
        if (suite.selectable) suite.checked = checked;
    }
}

function keyOf(row) {
    return row.kind + ':' + row.specIndex + ':' + row.suiteIndex;
}

function specKey(specIndex) {
    return 'spec:' + specIndex + ':-1';
}

function indexOfKey(state, key) {
    return visibleRows(state).findIndex((row) => keyOf(row) === key);
}

// Puts the cursor back on a row after the list has changed around it, or on the spec
// the row was in. Returns false, with the cursor left alone, when neither is shown.
function keepCursorOn(state, row) {
    if (!row) return false;
    for (const key of [keyOf(row), specKey(row.specIndex)]) {
        const at = indexOfKey(state, key);
        if (at !== -1) {
            state.cursor = at;
            return true;
        }
    }
    return false;
}

// Where the cursor belongs when it is sent to a spec. A spec found through one of
// its contexts takes the cursor to that context, so that ticking there ticks what
// was searched for rather than the whole spec.
function landingKey(state, specIndex) {
    const match = isSearching(state) ? state.search.matches.get(specIndex) : null;
    if (!match || match.firstHit === -1) return specKey(specIndex);
    return 'suite:' + specIndex + ':' + match.firstHit;
}

// Ticking can move a row, or hide it. A row that stays where it was keeps the
// cursor. So does a context, or an opened spec, because the person is working inside
// it. Otherwise the cursor goes to the spec that came next, so that several can be
// ticked one after another without being carried to the top of the list each time.
function placeCursorAfterTick(next, before) {
    const row = before[next.cursor];
    const now = indexOfKey(next, keyOf(row));
    const stays = now === next.cursor || row.kind === 'suite' || next.specs[row.specIndex].open;
    if (now !== -1 && stays) {
        next.cursor = now;
        return;
    }
    const other = (r) => r.kind === 'spec' && r.specIndex !== row.specIndex;
    const neighbour = before.slice(next.cursor + 1).find(other) || before.slice(0, next.cursor).reverse().find(other);
    const at = neighbour ? indexOfKey(next, landingKey(next, neighbour.specIndex)) : -1;
    if (at !== -1) next.cursor = at;
}

// Puts the cursor on the best result, past the ticked specs drawn above it.
function placeCursorOnResult(state) {
    const found = shownSpecs(state).filter((i) => state.search.matches.has(i));
    const unticked = found.find((i) => !state.specs[i].checked);
    const target = unticked === undefined ? found[0] : unticked;
    state.cursor = target === undefined ? 0 : indexOfKey(state, landingKey(state, target));
}

// `row` is the one the cursor is on, which it stays on when the search is emptied.
function setQuery(state, query, row) {
    state.search.query = query;
    state.search.matches = findMatches(state.specs, query);
    if (isSearching(state)) placeCursorOnResult(state);
    else keepCursorOn(state, row);
}

function reduce(state, keyName, text = '') {
    const next = clone(state);
    step(next, keyName, text);
    // A list with nothing in it still has to leave the cursor at zero.
    next.cursor = Math.max(0, Math.min(next.cursor, visibleRows(next).length - 1));
    return next;
}

// Changes `next` in place. reduce has already made the copy.
function step(next, keyName, text) {
    const rows = visibleRows(next);
    const row = rows[next.cursor];
    const { search } = next;

    switch (keyName) {
        case 'up':
            next.cursor -= 1;
            return;
        case 'down':
            next.cursor += 1;
            return;
        case 'open':
            if (row && row.kind === 'spec') next.specs[row.specIndex].open = true;
            return;
        case 'close':
            if (!row) return;
            next.specs[row.specIndex].open = false;
            next.cursor = indexOfKey(next, specKey(row.specIndex));
            return;
        case 'toggle': {
            // A note row is there to be read. There is nothing on it to tick.
            if (!row || row.kind === 'note') return;
            const spec = next.specs[row.specIndex];
            if (row.kind === 'spec') {
                setSpec(spec, !spec.checked);
                placeCursorAfterTick(next, rows);
                return;
            }
            const suite = spec.suites[row.suiteIndex];
            if (!suite.selectable) return;
            // Ticking a context ticks the contexts inside it, the same way ticking a
            // spec ticks its contexts. Without this, ticking a parent sent the parent
            // as wanted and every child as not wanted, and the children were then
            // excluded from a run the person thought they had asked for.
            const want = !suite.checked;
            for (const other of spec.suites) {
                if (other.selectable && (other === suite || isInside(other.path, suite.path))) {
                    other.checked = want;
                }
            }
            syncSpecFromSuites(spec);
            placeCursorAfterTick(next, rows);
            return;
        }
        case 'all':
        case 'none':
            // While searching, these act on the results that are shown and on nothing
            // else. A ticked spec that is only listed above them is left alone.
            for (const i of shownSpecs(next)) {
                if (isSearching(next) && !search.matches.has(i)) continue;
                setSpec(next.specs[i], keyName === 'all');
            }
            keepCursorOn(next, row);
            return;
        case 'search-start':
            search.typing = true;
            return;
        case 'search-type':
            setQuery(next, search.query + text, row);
            return;
        case 'search-backspace':
            // Backspace with nothing typed leaves the search.
            if (search.query === '') search.typing = false;
            else setQuery(next, Array.from(search.query).slice(0, -1).join(''), row);
            return;
        case 'search-accept':
            search.typing = false;
            if (!isSearching(next)) setQuery(next, '', row);
            return;
        case 'search-end':
            search.typing = false;
            setQuery(next, '', row);
            return;
        case 'search-ticked':
            if (!isSearching(next)) return;
            search.hideTicked = !search.hideTicked;
            if (!keepCursorOn(next, row)) placeCursorOnResult(next);
            return;
        default:
    }
}

function toPickedSpecs(state) {
    return state.specs.map((spec) => ({
        relative: spec.relative,
        checked: spec.checked,
        // A spec carrying `only` is sent whole, with no filter. See buildSelection.
        hasOnly: carriesOnly(spec),
        suites: spec.suites.map((x) => ({
            path: x.path,
            checked: x.checked,
            selectable: x.selectable,
            // Cannot be ticked, but would still run if the spec were sent whole. A
            // skipped context does not run either way, so it does not count. One
            // inside a context whose title could not be read does, and that is why
            // such a spec can never be treated as "everything is ticked".
            runsAnyway: !x.selectable && x.modifier !== 'skip',
        })),
    }));
}

// Mocha's only beats anything this package does, so the honest thing is to say what
// will actually run rather than to pretend the picked contexts decide it.
//
// Two lines can come out of one spec. The first names the markers. The second is
// printed only when the person narrowed that spec as well, and says their ticks
// were not applied, because the spec is sent whole in that case. Before this, the
// first line was printed and the ticks were sent anyway, and the result was a run
// that scheduled no tests at all and still reported success.
function warnings(state) {
    const lines = [];
    for (const spec of state.specs) {
        if (!spec.checked || !carriesOnly(spec)) continue;

        // onlySuites already holds every suite in the file carrying the marker,
        // wherever it sits, so the listed contexts must not be counted again.
        const markedSuites = spec.onlySuites;
        const parts = [];
        if (markedSuites.length > 0) {
            parts.push(markedSuites.map((x) => "'" + (x.title === null ? '?' : x.title) + "'").join(', '));
        }
        if (spec.onlyTests > 0) {
            parts.push(spec.onlyTests + (spec.onlyTests === 1 ? ' test' : ' tests'));
        }
        const willRun = markedSuites.reduce((sum, x) => sum + x.tests, 0) + spec.onlyTests;
        lines.push(
            spec.relative + ' carries only on ' + parts.join(' and ') + ', so ' + willRun +
            ' of its ' + spec.tests + ' tests will run whatever is ticked here.'
        );

        const selectable = spec.suites.filter((x) => x.selectable);
        const ticked = selectable.filter((x) => x.checked).length;
        if (selectable.length > 0 && ticked < selectable.length) {
            lines.push(
                '  The contexts ticked in ' + spec.relative + ' were not applied. That file is run ' +
                'whole, because only decides what runs in it.'
            );
        }
    }
    return lines;
}

module.exports = { createState, visibleRows, reduce, isSearching, searchSummary, toPickedSpecs, warnings };
