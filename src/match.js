'use strict';

// The rule that decides what runs when the picker has narrowed a spec to some of
// its contexts. This module is loaded both in Node, where it is tested, and in the
// browser by support/index.js, so it has no imports and uses nothing browser
// specific.
//
// A title path is the chain of suite titles from the outermost one inward. A
// selection is two lists of those paths: the contexts that were ticked, and the
// contexts that were left unticked.
//
// Both lists are needed. With only the ticked list, a ticked parent let back in a
// child that the person had just unticked, because the child sits inside something
// ticked. The list then said "some contexts" while every test in the spec ran.

// True when `shorter` matches the start of `longer`, title for title.
function isPrefix(shorter, longer) {
    if (shorter.length > longer.length) return false;
    for (let i = 0; i < shorter.length; i += 1) {
        if (shorter[i] !== longer[i]) return false;
    }
    return true;
}

// The nearest answer wins. Of all the ticked and unticked paths that `path` sits
// at or inside, the longest one is the one the person meant, because it is the one
// closest to the suite being judged. Returns true for ticked, false for unticked,
// and null when neither list says anything about this path.
function nearestAnswer(path, selected, excluded) {
    let closest = -1;
    let answer = null;
    for (const sel of selected || []) {
        if (isPrefix(sel, path) && sel.length > closest) {
            closest = sel.length;
            answer = true;
        }
    }
    for (const ex of excluded || []) {
        if (isPrefix(ex, path) && ex.length > closest) {
            closest = ex.length;
            answer = false;
        }
    }
    return answer;
}

// A suite registers when it contains something ticked, or when the nearest answer
// about it is "ticked". The first of those is why the outermost suite always
// registers: the ticked contexts cannot exist without their parent.
function shouldRegisterSuite(titlePath, selected, excluded) {
    if (!selected || selected.length === 0) return true;
    if (selected.some((sel) => isPrefix(titlePath, sel))) return true;
    return nearestAnswer(titlePath, selected, excluded) === true;
}

// A test registers only when the nearest answer about the suite it sits in is
// "ticked". Containing a ticked context is not enough, which is what keeps loose
// tests in the outermost suite out of a run that asked for one context.
function shouldRegisterTest(enclosingPath, selected, excluded) {
    if (!selected || selected.length === 0) return true;
    return nearestAnswer(enclosingPath, selected, excluded) === true;
}

module.exports = { isPrefix, nearestAnswer, shouldRegisterSuite, shouldRegisterTest };
