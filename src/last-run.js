'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { scanFile } = require('./spec-scan');

// The last run is kept under node_modules/.cache, the folder other tools use for the
// same purpose. It is already ignored by git in almost every project, so nothing new
// appears in the person's working tree, and deleting node_modules clears it.
function lastRunPath(root) {
    return path.join(root, 'node_modules', '.cache', 'cypress-pick', 'last.json');
}

// Saved before Cypress starts, not after it finishes, because the run most worth
// replaying is the one that failed or was stopped part way.
function saveLastRun(root, { selection, how, passthrough }) {
    const file = lastRunPath(root);
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ version: 1, selection, how, passthrough }, null, 2));
        return true;
    } catch (err) {
        return false;
    }
}

function isStringList(value) {
    return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

// Returns { run } or { problem }, where problem is a line to print. A file that is
// missing, unreadable or not in the shape written above is treated the same way:
// there is nothing trustworthy to replay.
function loadLastRun(root) {
    let data;
    try {
        data = JSON.parse(fs.readFileSync(lastRunPath(root), 'utf8'));
    } catch (err) {
        return { problem: 'There is no earlier run to replay. Run cypress-pick once without --last first.' };
    }
    const ok = data && data.version === 1 &&
        data.selection && isStringList(data.selection.specs) && data.selection.specs.length > 0 &&
        data.selection.filter && typeof data.selection.filter === 'object' &&
        data.how && (data.how.kind === 'cypress' || (data.how.kind === 'script' && typeof data.how.name === 'string')) &&
        isStringList(data.passthrough);
    if (!ok) {
        return { problem: 'The saved run could not be read. Run cypress-pick once without --last to save a new one.' };
    }
    return { run: { selection: data.selection, how: data.how, passthrough: data.passthrough } };
}

// The specs may have changed since the run was saved. A deleted spec would make
// Cypress fail on a path that no longer exists, and a renamed ticked context is
// worse: it matches nothing, and when every ticked context is gone the filter is
// empty and the whole spec runs. Both are refused rather than replayed differently
// from what was picked. An unticked context that has gone is harmless and ignored.
function staleParts(root, selection) {
    const lines = [];
    for (const spec of selection.specs) {
        const full = path.join(root, spec);
        if (!fs.existsSync(full)) { lines.push(spec + ' no longer exists'); continue; }
        const entry = selection.filter[spec];
        if (!entry || !Array.isArray(entry.include) || entry.include.length === 0) continue;
        const known = new Set(scanFile(full).suites.map((s) => JSON.stringify(s.path)));
        for (const p of entry.include) {
            if (!known.has(JSON.stringify(p))) lines.push(spec + ': context "' + p.join(' > ') + '" no longer exists');
        }
    }
    return lines;
}

function describeLastRun(run) {
    const where = run.how.kind === 'cypress' ? 'running Cypress directly' : 'through npm run ' + run.how.name;
    const lines = ['Replaying the last run, ' + where + ':'];
    for (const spec of run.selection.specs) {
        lines.push('  ' + spec + (run.selection.filter[spec] ? '   some contexts' : ''));
    }
    if (run.passthrough.length > 0) lines.push('  with ' + run.passthrough.join(' '));
    return lines;
}

module.exports = { lastRunPath, saveLastRun, loadLastRun, staleParts, describeLastRun };
