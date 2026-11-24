'use strict';

// Fuzzy matching for the search in the list. Plain functions, no dependency.
//
// A query is split on spaces, and every term in it has to match. A term matches in
// one of four ways, best first:
//
//   1. it is in the text as typed                    login    login-page
//   2. it is made of the starts of words, in order   audlog   audit-logs
//   3. it is a word with a typo in it                lgoin    login-page
//   4. its letters are there in order, close by      cnfbg    confirmed-bugs
//
// The fourth, and skipping words in the second, are only done where the caller asks
// for a loose match. That suits a short file name. Almost any few letters can be
// found in order in a long context title.

const SUBSTRING = 400;
const WORD_STARTS = 300;
const TYPO = 200;
const IN_ORDER = 100;

function terms(query) {
    return query.toLowerCase().split(/\s+/).filter(Boolean);
}

// The words of a text with the index each starts at. A capital after a small letter
// starts a word too, so that userProfile reads as two.
function wordsOf(text) {
    const words = [];
    const pattern = /[\p{L}\p{N}]+/gu;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        let offset = match.index;
        for (const part of match[0].split(/(?<=[\p{Ll}\p{N}])(?=\p{Lu})/u)) {
            words.push({ text: part.toLowerCase(), start: offset });
            offset += part.length;
        }
    }
    return words;
}

// True when the term can be cut into pieces that each begin a word, with the words
// in order. A loose match may skip words between two pieces.
function matchesWordStarts(term, words, loose) {
    const dead = new Set();
    const from = (termIndex, wordIndex) => {
        if (termIndex === term.length) return true;
        if (wordIndex === words.length) return false;
        const key = termIndex + ':' + wordIndex;
        if (dead.has(key)) return false;
        const word = words[wordIndex].text;
        let length = 0;
        while (length < word.length && termIndex + length < term.length && word[length] === term[termIndex + length]) {
            length += 1;
        }
        const least = loose || termIndex === 0 ? 0 : 1;
        for (let take = length; take >= least; take -= 1) {
            if (from(termIndex + take, wordIndex + 1)) return true;
        }
        dead.add(key);
        return false;
    };
    return from(0, 0);
}

// The fewest single letter changes that turn the term into some beginning of the
// word. Two letters swapped count as one change, because that is one slip.
function distanceToWordStart(term, word) {
    let beforeLast = null;
    let last = Array.from({ length: word.length + 1 }, (_, i) => i);
    for (let i = 1; i <= term.length; i += 1) {
        const row = [i];
        for (let j = 1; j <= word.length; j += 1) {
            const cost = term[i - 1] === word[j - 1] ? 0 : 1;
            row[j] = Math.min(last[j] + 1, row[j - 1] + 1, last[j - 1] + cost);
            if (beforeLast && j > 1 && term[i - 1] === word[j - 2] && term[i - 2] === word[j - 1]) {
                row[j] = Math.min(row[j], beforeLast[j - 2] + 1);
            }
        }
        beforeLast = last;
        last = row;
    }
    return Math.min(...last);
}

// How many slips a term is allowed. Short terms get none, because one change to a
// three letter term turns it into many unrelated words.
function allowedTypos(term) {
    if (term.length < 4) return 0;
    return term.length < 8 ? 1 : 2;
}

// The shortest stretch of text holding the letters of the term in order, or null.
function shortestInOrder(term, text) {
    let best = null;
    for (let start = text.indexOf(term[0]); start !== -1; start = text.indexOf(term[0], start + 1)) {
        let at = start;
        for (let i = 1; i < term.length && at !== -1; i += 1) at = text.indexOf(term[i], at + 1);
        if (at === -1) break;
        const span = at - start + 1;
        if (best === null || span < best) best = span;
    }
    return best;
}

// A score above zero when the term matches, zero when it does not.
function scoreTerm(term, text, { loose = false } = {}) {
    const lower = text.toLowerCase();
    const words = wordsOf(text);
    if (lower.includes(term)) {
        if (words.some((w) => w.text === term)) return SUBSTRING + 50;
        if (words.some((w) => lower.startsWith(term, w.start))) return SUBSTRING + 25;
        return SUBSTRING;
    }

    if (term.length >= (loose ? 2 : 3) && matchesWordStarts(term, words, loose)) return WORD_STARTS;

    const allowed = allowedTypos(term);
    if (allowed > 0) {
        const distance = words.reduce((min, w) => Math.min(min, distanceToWordStart(term, w.text)), Infinity);
        if (distance <= allowed) return TYPO - distance;
    }

    if (loose && term.length >= 2) {
        const span = shortestInOrder(term, lower);
        if (span !== null && span <= term.length * 3) return Math.max(1, IN_ORDER - span);
    }
    return 0;
}

module.exports = { terms, scoreTerm };
