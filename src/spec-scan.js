'use strict';

const fs = require('node:fs');

// Reads the describe and context blocks out of a spec file.
//
// A spec file cannot simply be searched for the word "context", because real spec
// files are full of comments and strings that mention it. The tracker below walks
// the file one character at a time so it always knows whether it is inside a
// comment or a string, and only counts a suite found in actual code.
//
// Nesting is worked out from curly brace depth. A suite's body adds exactly one
// level, so a suite recorded at depth N sits inside the most recent suite recorded
// at a lower depth.

const SUITE_WORDS = ['describe', 'context'];
const TEST_WORDS = ['it', 'specify'];

function isWordChar(c) {
    return /[A-Za-z0-9_$]/.test(c);
}

// Reads a quoted string that starts at `i`. Returns the text and where it ended, or
// null when the quote at `i` opens a template that contains a substitution, because
// such a title cannot be known without running the file.
function readQuoted(source, i) {
    const quote = source[i];
    if (quote !== "'" && quote !== '"' && quote !== '`') return null;
    let out = '';
    let j = i + 1;
    while (j < source.length) {
        const c = source[j];
        if (c === '\\') {
            // Keep the escaped character as written, apart from the two escapes a
            // title realistically uses.
            const next = source[j + 1];
            out += next === 'n' ? '\n' : next;
            j += 2;
            continue;
        }
        if (quote === '`' && c === '$' && source[j + 1] === '{') return null;
        if (c === quote) return { text: out, end: j };
        out += c;
        j += 1;
    }
    return null;
}

// Skips a whole template literal, including any ${...} substitution inside it.
// A substitution can itself contain an object literal, so it can contain braces
// that have nothing to do with the file's own suite nesting. Those braces must
// be tracked on their own, or they are counted into the file's brace depth and
// a suite can be closed by a brace that was never its own.
function skipTemplateLiteral(source, i) {
    let j = i + 1;
    while (j < source.length) {
        const c = source[j];
        if (c === '\\') {
            j += 2;
            continue;
        }
        if (c === '`') return j;
        if (c === '$' && source[j + 1] === '{') {
            let braces = 1;
            j += 2;
            while (j < source.length && braces > 0) {
                if (source[j] === '{') braces += 1;
                else if (source[j] === '}') braces -= 1;
                else if (source[j] === '`') j = skipTemplateLiteral(source, j);
                j += 1;
            }
            continue;
        }
        j += 1;
    }
    return source.length;
}

function scanSource(source) {
    const suites = [];
    const open = []; // suites whose body we are inside, innermost last
    let depth = 0;   // curly brace depth
    let tests = 0;
    let i = 0;

    const closeFinished = () => {
        while (open.length > 0 && depth <= open[open.length - 1].braceDepth) {
            open.pop();
        }
    };

    while (i < source.length) {
        const c = source[i];

        // Comments
        if (c === '/' && source[i + 1] === '/') {
            const nl = source.indexOf('\n', i);
            i = nl === -1 ? source.length : nl;
            continue;
        }
        if (c === '/' && source[i + 1] === '*') {
            const end = source.indexOf('*/', i + 2);
            i = end === -1 ? source.length : end + 2;
            continue;
        }

        // Strings that are not a suite title. Skipping them whole is what keeps a
        // string such as "context('fake')" from being counted.
        if (c === "'" || c === '"' || c === '`') {
            const quoted = readQuoted(source, i);
            if (quoted) {
                i = quoted.end + 1;
                continue;
            }
            if (c === '`') {
                // A template with a substitution in it. Skip the whole literal as
                // one unit, so a brace inside the substitution is never mistaken
                // for one of the file's own.
                i = skipTemplateLiteral(source, i) + 1;
                continue;
            }
            // An unterminated string. Step past the opening quote and carry on
            // rather than stopping the scan.
            i += 1;
            continue;
        }

        if (c === '{') {
            depth += 1;
            i += 1;
            continue;
        }
        if (c === '}') {
            depth -= 1;
            closeFinished();
            i += 1;
            continue;
        }

        if (isWordChar(c) && !isWordChar(source[i - 1] || '')) {
            let j = i;
            while (j < source.length && isWordChar(source[j])) j += 1;
            const word = source.slice(i, j);

            if (SUITE_WORDS.includes(word) || TEST_WORDS.includes(word)) {
                let k = j;
                let modifier = null;
                if (source[k] === '.') {
                    let m = k + 1;
                    while (m < source.length && isWordChar(source[m])) m += 1;
                    const suffix = source.slice(k + 1, m);
                    if (suffix === 'only' || suffix === 'skip') {
                        modifier = suffix;
                        k = m;
                    }
                }
                while (k < source.length && /\s/.test(source[k])) k += 1;

                if (source[k] === '(') {
                    let t = k + 1;
                    while (t < source.length && /\s/.test(source[t])) t += 1;
                    const quoted = readQuoted(source, t);

                    if (TEST_WORDS.includes(word)) {
                        tests += 1;
                        for (const s of open) s.tests += 1;
                    } else {
                        closeFinished();
                        const parent = open[open.length - 1] || null;
                        const title = quoted ? quoted.text : null;
                        const suite = {
                            title,
                            path: (parent ? parent.path : []).concat(title === null ? '' : title),
                            depth: parent ? parent.depth + 1 : 0,
                            tests: 0,
                            modifier,
                            readable: quoted !== null,
                            braceDepth: depth,
                        };
                        suites.push(suite);
                        open.push(suite);
                    }
                    if (quoted) {
                        i = quoted.end + 1;
                    } else if (source[t] === '`') {
                        // Same unreadable template case as above: skip the whole
                        // literal, braces inside the substitution and all, so the
                        // suite this title belongs to is not closed early.
                        i = skipTemplateLiteral(source, t) + 1;
                    } else {
                        i = k + 1;
                    }
                    continue;
                }
            }
            i = j;
            continue;
        }

        i += 1;
    }

    // braceDepth is working memory for the scan, not part of what callers get.
    for (const s of suites) delete s.braceDepth;
    return { suites, tests };
}

function scanFile(absolutePath) {
    return scanSource(fs.readFileSync(absolutePath, 'utf8'));
}

module.exports = { scanSource, scanFile };
