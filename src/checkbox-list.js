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

const QUIT_KEYS = ['q', '\u0003', '\u001b'];
const ACCEPT_KEYS = ['\r', '\n'];

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
// undone before it returns, including on Ctrl+C, because a terminal left in raw mode
// with the cursor hidden is unusable afterwards.
function promptList(state, { title, stdin = process.stdin, stdout = process.stdout } = {}) {
    return new Promise((resolve) => {
        let current = state;
        let drawnLines = 0;

        const draw = () => {
            if (drawnLines > 0) stdout.write('\u001b[' + drawnLines + 'A\u001b[0J');
            const lines = renderLines(current, { title });
            stdout.write(lines.join('\n') + '\n');
            drawnLines = lines.length;
        };

        const restore = () => {
            stdin.removeListener('data', onData);
            if (stdin.isTTY) stdin.setRawMode(false);
            stdin.pause();
            stdout.write('\u001b[?25h');
        };

        const onData = (chunk) => {
            const key = chunk.toString();

            if (QUIT_KEYS.includes(key)) {
                restore();
                resolve(null);
                return;
            }
            if (ACCEPT_KEYS.includes(key)) {
                restore();
                resolve(current);
                return;
            }
            const action = KEYS[key];
            if (!action) return;
            current = reduce(current, action);
            draw();
        };

        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
        stdout.write('\u001b[?25l');
        draw();
    });
}

module.exports = { renderLines, promptList, KEYS, QUIT_KEYS, ACCEPT_KEYS };
