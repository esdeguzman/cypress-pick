'use strict';

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

function createState(scannedSpecs) {
    return {
        cursor: 0,
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

function visibleRows(state) {
    const rows = [];
    state.specs.forEach((spec, specIndex) => {
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
        if (!spec.open) return;
        // Opening a spec that has nothing to tick used to show nothing at all, which
        // reads as the picker having failed. Say why instead.
        if (spec.suites.length === 0) {
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
        spec.suites.forEach((suite, suiteIndex) => {
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

function reduce(state, keyName) {
    const next = clone(state);
    const rows = visibleRows(next);
    const row = rows[next.cursor];

    switch (keyName) {
        case 'up':
            next.cursor = Math.max(0, next.cursor - 1);
            return next;
        case 'down':
            next.cursor = Math.min(rows.length - 1, next.cursor + 1);
            return next;
        case 'open':
            if (row && row.kind === 'spec') next.specs[row.specIndex].open = true;
            return next;
        case 'close':
            if (!row) return next;
            if (row.kind === 'suite') {
                next.specs[row.specIndex].open = false;
                next.cursor = visibleRows(next).findIndex((r) => r.kind === 'spec' && r.specIndex === row.specIndex);
                return next;
            }
            next.specs[row.specIndex].open = false;
            return next;
        case 'toggle': {
            if (!row) return next;
            const spec = next.specs[row.specIndex];
            if (row.kind === 'spec') {
                setSpec(spec, !spec.checked);
                return next;
            }
            const suite = spec.suites[row.suiteIndex];
            if (!suite.selectable) return next;
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
            return next;
        }
        case 'all':
            for (const spec of next.specs) setSpec(spec, true);
            return next;
        case 'none':
            for (const spec of next.specs) setSpec(spec, false);
            return next;
        default:
            return next;
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

module.exports = { createState, visibleRows, reduce, toPickedSpecs, warnings };
