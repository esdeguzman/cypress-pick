'use strict';

const { visibleRows, reduce, isSearching, searchSummary } = require('./list-state');

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

// r accepts and asks for a headless run, which is cypress run with no second
// question about how to run. Only the spec list binds it: the same widget draws
// the "How should it run?" list, where there is nothing for a headless key to
// mean, and there r is an unmapped key like any other.
const HEADLESS_KEY = 'r';

// Search is opted into the same way, and for the same reason. While a search is
// being typed the letters are text, so only these keys keep a meaning. Shift+Tab is
// the key for the ticked specs because it works both while typing and after.
const SEARCH_KEY = '/';
const SEARCH_TICKED_KEY = '\u001b[Z';
const TYPING_KEYS = {
    '\u001b[A': 'up',
    '\u001b[B': 'down',
    '\u001b[C': 'open',
    '\u001b[D': 'close',
    '\t': 'toggle',
    '\r': 'search-accept',
    '\n': 'search-accept',
    '\u007f': 'search-backspace',
    '\b': 'search-backspace',
    '\u0015': 'search-end', // Ctrl+U
    [SEARCH_TICKED_KEY]: 'search-ticked',
};

// How long a lone escape byte is held, during a search, before it counts as the
// escape key and ends the search. See isPartialEscape.
const ESCAPE_WAIT_MS = 100;

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

// Set CYPRESS_PICK_TRACE to a file path to record everything the list sends to the
// terminal, one write per line. It is for chasing a redraw that lands in the wrong
// place: the recording can be replayed against a model of a terminal to see where
// each draw actually went.
const TRACE = process.env.CYPRESS_PICK_TRACE;

function record(entry) {
    if (!TRACE) return;
    require('node:fs').appendFileSync(TRACE, JSON.stringify(entry) + '\n');
}

function pad(text, width) {
    return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

// The row under the cursor is drawn in reverse video. A ticked row, whole or
// partial, is drawn in green. A ticked row under the cursor gets both.
const STYLE_CURSOR = '[7m';
const STYLE_TICKED = '[32m';
const STYLE_RESET = '[0m';

const WRAP_OFF = '\u001b[?7l';
const WRAP_ON = '\u001b[?7h';

// The list asks the terminal for a screen of its own, the way vim and less do, and
// hands it back when it closes. Drawn in the normal screen it could not work: the
// terminal already holds the command that was typed and whatever was printed above,
// so a drawing the height of the window pushes that off, the window scrolls, and a
// redraw can no longer reach the top of what it drew. The shell's own output is left
// exactly as it was.
const SCREEN_OWN = '\u001b[?1049h';
const SCREEN_BACK = '\u001b[?1049l';
const HIDE_CURSOR = '\u001b[?25l';
const SHOW_CURSOR = '\u001b[?25h';

// Drawing from the top of that screen, over what is already on it, is what stops the
// list blinking on every key. Erasing first and then drawing leaves the screen empty
// in between, which a terminal that paints slowly, such as Command Prompt, shows.
const TO_TOP = '\u001b[H';
const CLEAR_LINE = '\u001b[K'; // from the cursor to the end of its row
const CLEAR_BELOW = '\u001b[0J'; // from the cursor to the end of the screen

function highlight(text, { onCursor, ticked }) {
    const style = (onCursor ? STYLE_CURSOR : '') + (ticked ? STYLE_TICKED : '');
    return style ? style + text + STYLE_RESET : text;
}

// Color only goes to a terminal, and NO_COLOR (https://no-color.org) turns it off.
function wantsColor(stdout, env = process.env) {
    return Boolean(stdout.isTTY) && !env.NO_COLOR;
}

// The line under the title while a search is on. The underscore marks that letters
// typed now go into it.
function searchLine(state) {
    const { typing, query, hideTicked } = state.search;
    const text = '  search: ' + query + (typing ? '_' : '');
    if (!isSearching(state)) return text;
    const { found, tickedShown, tickedHidden } = searchSummary(state);
    const parts = [found === 0 ? 'nothing found' : found + (found === 1 ? ' spec found' : ' specs found')];
    if (hideTicked) parts.push(tickedHidden + ' ticked hidden');
    else if (tickedShown > 0) parts.push(tickedShown + ' ticked shown');
    return text + '    ' + parts.join(', ');
}

function footerLines(state, { allowHeadless, allowSearch }) {
    const marks = '  [x] whole spec   [~] some contexts   [ ] not running';
    const ticked = 'shift+tab ' + (state.search.hideTicked ? 'show' : 'hide') + ' ticked';
    if (state.search.typing) {
        return [
            marks,
            '  type to search   up/down move   tab tick   right open   left close',
            '  enter done typing   ' + ticked + '   esc end search',
        ];
    }
    const moves = '  up/down move   space tick   right open   left close   a all   n none';
    const run = '  enter run' + (allowHeadless ? '   r headless' : '');
    if (isSearching(state)) {
        return [marks, moves, run + '   / edit   ' + ticked + '   esc end   q quit'];
    }
    return [marks, moves, run + (allowSearch ? '   / search' : '') + '   q quit'];
}

// Cut to the terminal's width. This counts characters, so a line holding wide ones,
// such as an emoji, can still be too long. promptList turns line wrapping off for
// that, because a line that wraps takes up two, and the redraw moves up by the number
// of lines it wrote.
function clip(text, columns) {
    return columns && text.length >= columns ? text.slice(0, columns - 1) : text;
}

// A title written over several lines would otherwise be drawn over several too.
function oneLine(text) {
    return text.replace(/[\u0000-\u001f\u007f]+/g, ' ');
}

// The fewest lines worth giving the list: three rows, and the two lines saying how
// much is out of sight.
const LEAST_ROOM = 5;

// What goes around the list. A short terminal, such as a small editor panel, gets
// less of it. What is drawn must never be taller than the terminal: it would scroll,
// the redraw could not reach the top of it, and every key would push it further up.
//
// One line is left for the terminal's own cursor, which sits below the list.
function layoutFor(state, { title, height, allowHeadless, allowSearch }) {
    const search = state.search.typing || isSearching(state) ? [searchLine(state)] : [];
    const name = ['  ' + title];
    const [marks, moves, run] = footerLines(state, { allowHeadless, allowSearch });
    const layouts = [
        { head: ['', ...name, ...search, ''], foot: ['', marks, moves, run] },
        { head: [...name, ...search], foot: [moves, run] },
        { head: search.length > 0 ? search : name, foot: [run] },
        { head: search.length > 0 ? search : name, foot: [] },
    ];
    if (!height) return { ...layouts[0], room: Infinity };
    const sized = layouts.map((x) => ({ ...x, room: height - x.head.length - x.foot.length - 1 }));
    const last = sized[sized.length - 1];
    return sized.find((x) => x.room >= LEAST_ROOM) || { ...last, room: Math.max(1, last.room) };
}

// Which rows fit. The cursor's row is kept in the middle where there is room.
function windowOf(count, cursor, space) {
    const from = Math.max(0, Math.min(cursor - Math.floor(space / 2), count - space));
    return { from, to: from + space };
}

// `height` and `columns` are the size of the terminal. Without them everything is
// drawn at full length.
function renderLines(state, {
    title, width = 78, allowHeadless = false, allowSearch = false, color = false, height, columns,
} = {}) {
    const rows = visibleRows(state);
    const { head, foot, room } = layoutFor(state, { title, height, allowHeadless, allowSearch });

    // A list that does not fit is drawn a part at a time. It gives up two lines to say
    // how much is out of sight, where there is room to. Both are always there, so
    // nothing jumps as the list scrolls.
    const scrolls = rows.length > room;
    const counts = scrolls && room >= 3;
    const { from, to } = scrolls
        ? windowOf(rows.length, state.cursor, counts ? room - 2 : room)
        : { from: 0, to: rows.length };

    const lines = head.map((line) => clip(line, columns));
    if (counts) lines.push(from > 0 ? '      ' + from + ' more above' : '');
    rows.slice(from, to).forEach((row, offset) => {
        const onCursor = from + offset === state.cursor;
        const cursor = onCursor ? '>' : ' ';
        const indent = '  '.repeat(row.depth);
        const box = row.selectable ? '[' + row.mark + ']' : ' - ';
        const left = cursor + ' ' + box + ' ' + indent + oneLine(row.label);
        const right = row.kind === 'spec' ? String(row.tests) : '';
        const note = row.note ? '  ' + row.note : '';
        const line = clip(pad(left, width - 6) + pad(right, 5) + note, columns);
        const ticked = row.selectable && row.mark !== ' ';
        lines.push(color ? highlight(line, { onCursor, ticked }) : line);
    });
    if (counts) lines.push(to < rows.length ? '      ' + (rows.length - to) + ' more below' : '');

    return lines.concat(foot.map((line) => clip(line, columns)));
}

// Reads keys until the user accepts or quits. Everything it does to the terminal is
// undone before it returns, including on Ctrl+C and on an exception, because a
// terminal left in raw mode with the cursor hidden is unusable afterwards.
//
// Quitting resolves null. Accepting resolves { state, accept }, because there is
// more than one way to accept and the caller has to be able to tell them apart.
function promptList(state, {
    title, stdin = process.stdin, stdout = process.stdout, allowHeadless = false, allowSearch = false,
} = {}) {
    return new Promise((resolve, reject) => {
        let current = state;
        let drawnLines = 0;
        let pending = ''; // a held prefix of a split escape sequence, or an empty string
        let escapeTimer = null; // runs while a lone escape byte is held during a search
        let restored = false;
        const color = wantsColor(stdout);

        // While a recording is being made, anything that is not the list is recorded
        // too, because another writer moving the cursor would put the next draw
        // somewhere other than the top of the screen.
        let writing = false;
        const realWrite = stdout.write.bind(stdout);
        if (TRACE) {
            stdout.write = (...args) => {
                if (!writing) record({ other: String(args[0]) });
                return realWrite(...args);
            };
        }

        const write = (text) => {
            record({ write: text });
            writing = true;
            try {
                realWrite(text);
            } finally {
                writing = false;
            }
        };

        const draw = () => {
            const lines = renderLines(current, {
                title, allowHeadless, allowSearch, color, height: stdout.rows, columns: stdout.columns,
            });
            record({ draw: lines.length, drawnBefore: drawnLines, rows: stdout.rows, columns: stdout.columns });
            // No line break after the last line: on the last row of the screen it
            // would scroll, and then the top of the drawing would be out of reach.
            let text = TO_TOP + lines.join(CLEAR_LINE + '\n') + CLEAR_LINE;
            // Rows the last drawing used and this one does not would otherwise keep
            // showing its tail.
            if (lines.length < drawnLines) text += CLEAR_BELOW;
            write(text);
            drawnLines = lines.length;
        };

        // Safe to call more than once. A quit key, an accept key, a thrown exception
        // and a stream error can each reach here, and only the first one should act.
        const restore = () => {
            if (restored) return;
            restored = true;
            clearTimeout(escapeTimer);
            stdin.removeListener('data', onData);
            stdin.removeListener('error', onError);
            if (stdin.isTTY) stdin.setRawMode(false);
            stdin.pause();
            // The terminal keeps wrapping and the cursor as they are set here, so
            // both are put back before the screen is handed over.
            write(WRAP_ON + SHOW_CURSOR + SCREEN_BACK);
            if (TRACE) stdout.write = realWrite;
        };

        const act = (action, text) => {
            current = reduce(current, action, text);
            draw();
            return true;
        };

        // Text being typed into the search. A paste, or a slow connection, can deliver
        // several characters at once. Enter ends the typing, and anything that came
        // after it in the same chunk is dropped rather than read as keys.
        const handleTyping = (text) => {
            if (TYPING_KEYS[text]) return act(TYPING_KEYS[text]);
            if (text.startsWith('\u001b')) return false;
            for (const char of text) {
                if (char === '\u0003') return handleKey(char);
                if (TYPING_KEYS[char]) act(TYPING_KEYS[char]);
                else if (char >= ' ') act('search-type', char);
                if (!current.search.typing) return true;
            }
            return true;
        };

        // Tries to act on one piece of text as a key. Returns whether it recognised
        // it, so the caller can decide what to do with text it did not.
        const handleKey = (text) => {
            if (current.search.typing && text !== '\u0003') return handleTyping(text);
            if (QUIT_KEYS.includes(text)) {
                restore();
                resolve(null);
                return true;
            }
            if (ACCEPT_KEYS.includes(text)) {
                restore();
                resolve({ state: current, accept: 'ask' });
                return true;
            }
            if (allowHeadless && text === HEADLESS_KEY) {
                restore();
                resolve({ state: current, accept: 'headless' });
                return true;
            }
            if (allowSearch && text.startsWith(SEARCH_KEY)) {
                act('search-start');
                return text.length === 1 || handleTyping(text.slice(1));
            }
            if (allowSearch && text === SEARCH_TICKED_KEY) return act('search-ticked');
            const action = KEYS[text];
            return action ? act(action) : false;
        };

        // The escape key ends a search, but every arrow key starts with the same byte,
        // so it is held for a moment in case the rest of an arrow key follows. With no
        // search on, the key has no meaning and the byte is held until the next chunk.
        const holdPrefix = (text) => {
            pending = text;
            if (text !== '\u001b' || !(current.search.typing || isSearching(current))) return;
            escapeTimer = setTimeout(() => {
                pending = '';
                try {
                    act('search-end');
                } catch (err) {
                    restore();
                    reject(err);
                }
            }, ESCAPE_WAIT_MS);
        };

        const onData = (chunk) => {
            try {
                const raw = chunk.toString();
                record({ key: raw });
                const hadPrefix = pending.length > 0;
                const combined = pending + raw;
                pending = '';
                clearTimeout(escapeTimer);

                if (isPartialEscape(combined)) {
                    holdPrefix(combined);
                    return;
                }
                if (handleKey(combined)) return;

                if (hadPrefix) {
                    // The held prefix plus this chunk matched nothing, so it was a
                    // dead end, for example an escape key pressed on its own. Drop
                    // the stale prefix rather than losing the chunk that followed it.
                    if (isPartialEscape(raw)) {
                        holdPrefix(raw);
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
        record({ started: true, rows: stdout.rows, columns: stdout.columns, color });
        write(SCREEN_OWN + HIDE_CURSOR + WRAP_OFF);
        draw();
    });
}

module.exports = { renderLines, promptList, wantsColor, KEYS, QUIT_KEYS, ACCEPT_KEYS, HEADLESS_KEY };
