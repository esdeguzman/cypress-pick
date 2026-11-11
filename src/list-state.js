'use strict';

// Everything about the list that does not need a terminal. The drawing lives in
// src/checkbox-list.js, which calls into here for every key. Keeping the two apart
// is what makes the behaviour testable.

// A context that cannot be ticked is one the picker could not honour: a skipped one
// will not run whatever is asked, and one whose title could not be read cannot be
// named on the command line.
function noteFor(suite) {
    if (suite.modifier === 'skip') return 'skipped';
    if (!suite.readable) return 'title cannot be read';
    if (suite.modifier === 'only') return 'only';
    return null;
}

function selectableSuite(suite) {
    return suite.modifier !== 'skip' && suite.readable;
}

function createState(scannedSpecs) {
    return {
        cursor: 0,
        specs: scannedSpecs.map((s) => ({
            relative: s.relative,
            tests: s.tests,
            open: false,
            checked: false,
            suites: s.suites.map((x) => ({
                title: x.title,
                path: x.path,
                depth: x.depth,
                tests: x.tests,
                modifier: x.modifier,
                readable: x.readable,
                selectable: selectableSuite(x),
                note: noteFor(x),
                checked: false,
            })),
        })),
    };
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
            note: spec.suites.some((x) => x.modifier === 'only') ? 'only' : null,
            tests: spec.tests,
            open: spec.open,
        });
        if (!spec.open) return;
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
            suite.checked = !suite.checked;
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
        suites: spec.suites.map((x) => ({ path: x.path, checked: x.checked, selectable: x.selectable })),
    }));
}

// Mocha's only beats anything this package does, so the honest thing is to say what
// will actually run rather than to pretend the picked contexts decide it.
function warnings(state) {
    const lines = [];
    for (const spec of state.specs) {
        if (!spec.checked) continue;
        const only = spec.suites.filter((x) => x.modifier === 'only');
        if (only.length === 0) continue;
        const willRun = only.reduce((sum, x) => sum + x.tests, 0);
        const names = only.map((x) => "'" + (x.title === null ? '?' : x.title) + "'").join(', ');
        lines.push(
            spec.relative + ' carries only on ' + names + ', so ' + willRun + ' of its ' +
            spec.tests + ' tests will run whatever is ticked here.'
        );
    }
    return lines;
}

module.exports = { createState, visibleRows, reduce, toPickedSpecs, warnings };
