'use strict';

const { visibleRows, reduce } = require('./list-state');

const KEYS = {
    '\u001b[A': 'up',
    '\u001b[B': 'down',
    '\u001b[C': 'open',
    '\u001b[D': 'close',
    k: 'up',
    j: 'down',
    l: 'open',
    h: 'close',
    ' ': 'toggle',
    a: 'all',
    n: 'none',
};

// Only q and Ctrl+C quit. A lone escape byte must never quit on its own: every arrow
// key starts with that same byte, and a slow connection, such as an SSH session or a
// terminal multiplexer like tmux, can deliver it in its own chunk, ahead of the rest
// of the sequence. Treating it as a quit key there would close the picker on an arrow
// press, which is what happened before this file held a split sequence instead.
const QUIT_KEYS = ['q', '\u0003'];
const ACCEPT_KEYS = ['\r', '\n'];

// A chunk equal to just the escape byte, or to the escape byte followed by the
// bracket, is a strict prefix of one of the arrow sequences above and nothing else.
// It has to wait for the rest before it can be matched against anything.
function isPartialEscape(text) {
    return text === '\u001b' || text === '\u001b[';
}

function pad(text, width) {
    return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function renderLines(state, { title, width = 78 } = {}) {
    const rows = visibleRows(state);
    const lines = ['', '  ' + title, ''];

    rows.forEach((row, index) => {
        const cursor = index === state.cursor ? '>' : ' ';
        const indent = '  '.repeat(row.depth);
        const box = row.selectable ? '[' + row.mark + ']' : ' - ';
        const left = cursor + ' ' + box + ' ' + indent + row.label;
        const right = row.kind === 'spec' ? String(row.tests) : '';
        const note = row.note ? '  ' + row.note : '';
        lines.push(pad(left, width - 6) + pad(right, 5) + note);
    });

    lines.push('');
    lines.push('  [x] whole spec   [~] some contexts   [ ] not running');
    lines.push('  up/down move   space tick   right open   left close   a all   n none');
    lines.push('  enter run   q quit');
    return lines;
}

// Reads keys until the user accepts or quits. Everything it does to the terminal is
// undone before it returns, including on Ctrl+C and on an exception, because a
// terminal left in raw mode with the cursor hidden is unusable afterwards.
function promptList(state, { title, stdin = process.stdin, stdout = process.stdout } = {}) {
    return new Promise((resolve, reject) => {
        let current = state;
        let drawnLines = 0;
        let pending = ''; // a held prefix of a split escape sequence, or an empty string
        let restored = false;

        const draw = () => {
            if (drawnLines > 0) stdout.write('\u001b[' + drawnLines + 'A\u001b[0J');
            const lines = renderLines(current, { title });
            stdout.write(lines.join('\n') + '\n');
            drawnLines = lines.length;
        };

        // Safe to call more than once. A quit key, an accept key, a thrown exception
        // and a stream error can each reach here, and only the first one should act.
        const restore = () => {
            if (restored) return;
            restored = true;
            stdin.removeListener('data', onData);
            stdin.removeListener('error', onError);
            if (stdin.isTTY) stdin.setRawMode(false);
            stdin.pause();
            stdout.write('\u001b[?25h');
        };

        // Tries to act on one piece of text as a key. Returns whether it recognised
        // it, so the caller can decide what to do with text it did not.
        const handleKey = (text) => {
            if (QUIT_KEYS.includes(text)) {
                restore();
                resolve(null);
                return true;
            }
            if (ACCEPT_KEYS.includes(text)) {
                restore();
                resolve(current);
                return true;
            }
            const action = KEYS[text];
            if (!action) return false;
            current = reduce(current, action);
            draw();
            return true;
        };

        const onData = (chunk) => {
            try {
                const raw = chunk.toString();
                const hadPrefix = pending.length > 0;
                const combined = pending + raw;
                pending = '';

                if (isPartialEscape(combined)) {
                    pending = combined;
                    return;
                }
                if (handleKey(combined)) return;

                if (hadPrefix) {
                    // The held prefix plus this chunk matched nothing, so it was a
                    // dead end, for example an escape key pressed on its own. Drop
                    // the stale prefix rather than losing the chunk that followed it.
                    if (isPartialEscape(raw)) {
                        pending = raw;
                        return;
                    }
                    handleKey(raw);
                }
            } catch (err) {
                restore();
                reject(err);
            }
        };

        const onError = (err) => {
            restore();
            reject(err);
        };

        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
        stdin.on('error', onError);
        stdout.write('\u001b[?25l');
        draw();
    });
}

module.exports = { renderLines, promptList, KEYS, QUIT_KEYS, ACCEPT_KEYS };
