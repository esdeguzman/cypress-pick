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

// Skips a brace-delimited argument such as a config object, starting at the
// opening `{` at `i`. Returns the index of the matching closing brace. Strings,
// templates and comments inside it are skipped the same way the main scan
// skips them, so a brace written inside one of those is never counted.
function skipBraced(source, i) {
    let braces = 0;
    let j = i;
    while (j < source.length) {
        const c = source[j];
        if (c === '/' && source[j + 1] === '/') {
            const nl = source.indexOf('\n', j);
            j = nl === -1 ? source.length : nl;
            continue;
        }
        if (c === '/' && source[j + 1] === '*') {
            const end = source.indexOf('*/', j + 2);
            j = end === -1 ? source.length : end + 2;
            continue;
        }
        if (c === "'" || c === '"') {
            const quoted = readQuoted(source, j);
            j = quoted ? quoted.end + 1 : j + 1;
            continue;
        }
        if (c === '`') {
            j = skipTemplateLiteral(source, j) + 1;
            continue;
        }
        if (c === '{') {
            braces += 1;
            j += 1;
            continue;
        }
        if (c === '}') {
            braces -= 1;
            if (braces === 0) return j;
            j += 1;
            continue;
        }
        j += 1;
    }
    return source.length - 1;
}

// True when a `/` found right after `lastSignificant` opens a regex literal
// rather than a division. Telling the two apart needs the previous significant
// (non comment, non whitespace) character: a regex can follow an operator, a
// bracket or the start of the file, a division follows a value.
function isRegexContext(lastSignificant) {
    return lastSignificant === '' || '(,=:[!&|?{};'.includes(lastSignificant);
}

// Skips a regex literal that opens at `i`. A character class, [...], can hold
// an unescaped slash that does not close the literal, so it is tracked
// separately. Flags such as g or i follow the closing slash and are skipped
// too, so the scan does not restart mid flag. Returns the index of the last
// character read: the closing slash, or its last flag.
function skipRegexLiteral(source, i) {
    let j = i + 1;
    let inClass = false;
    while (j < source.length) {
        const c = source[j];
        if (c === '\\') {
            j += 2;
            continue;
        }
        if (c === '\n') return j - 1; // an unterminated regex; stop at the line
        if (c === '[') {
            inClass = true;
            j += 1;
            continue;
        }
        if (c === ']') {
            inClass = false;
            j += 1;
            continue;
        }
        if (c === '/' && !inClass) {
            j += 1;
            while (j < source.length && /[a-z]/i.test(source[j])) j += 1;
            return j - 1;
        }
        j += 1;
    }
    return source.length - 1;
}

function scanSource(source) {
    const suites = [];
    const open = []; // suites whose body we are inside, innermost last
    let depth = 0;   // curly brace depth
    let tests = 0;
    let i = 0;
    let lastSignificant = ''; // last non comment, non whitespace character read

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

        // A regex literal. Checked before strings, since `/` is not a quote
        // character, and before the general punctuation fallback, since a slash
        // written inside a regex must not be read as division partway through.
        if (c === '/' && isRegexContext(lastSignificant)) {
            const end = skipRegexLiteral(source, i);
            lastSignificant = source[end];
            i = end + 1;
            continue;
        }

        // Strings that are not a suite title. Skipping them whole is what keeps a
        // string such as "context('fake')" from being counted.
        if (c === "'" || c === '"' || c === '`') {
            const quoted = readQuoted(source, i);
            if (quoted) {
                lastSignificant = source[quoted.end];
                i = quoted.end + 1;
                continue;
            }
            if (c === '`') {
                // A template with a substitution in it. Skip the whole literal as
                // one unit, so a brace inside the substitution is never mistaken
                // for one of the file's own.
                const end = skipTemplateLiteral(source, i);
                lastSignificant = source[end];
                i = end + 1;
                continue;
            }
            // An unterminated string. Step past the opening quote and carry on
            // rather than stopping the scan.
            lastSignificant = c;
            i += 1;
            continue;
        }

        if (c === '{') {
            depth += 1;
            lastSignificant = c;
            i += 1;
            continue;
        }
        if (c === '}') {
            depth -= 1;
            closeFinished();
            lastSignificant = c;
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

                    if (SUITE_WORDS.includes(word)) {
                        // Cypress allows a config object between the title and the
                        // callback, for example describe('Title', { expose: {...}
                        // }, () => {}). braceDepth was just recorded as the depth
                        // OUTSIDE this call, before the callback's own body opens.
                        // Left to the main loop, the config object's own closing
                        // brace brings depth back down to that exact number, and
                        // closeFinished reads that as the suite's own body closing
                        // before it has even started. Skipping the object here as
                        // one unit, the same way skipTemplateLiteral skips a
                        // substitution, keeps depth from ever touching that number
                        // until the real body brace is reached.
                        let p = i;
                        while (p < source.length && /[\s,]/.test(source[p])) p += 1;
                        if (source[p] === '{') {
                            i = skipBraced(source, p) + 1;
                        }
                    }

                    lastSignificant = source[i - 1];
                    continue;
                }
            }
            lastSignificant = word[word.length - 1];
            i = j;
            continue;
        }

        if (!/\s/.test(c)) lastSignificant = c;
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
