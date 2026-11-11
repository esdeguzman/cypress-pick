'use strict';

// The rule that decides what runs when the picker has narrowed a spec to some of
// its contexts. This module is loaded both in Node, where it is tested, and in the
// browser by support/index.js, so it has no imports and uses nothing browser
// specific.
//
// A title path is the chain of suite titles from the outermost one inward. A
// selection is a list of those paths, one per ticked context.

// True when `shorter` matches the start of `longer`, title for title.
function isPrefix(shorter, longer) {
    if (shorter.length > longer.length) return false;
    for (let i = 0; i < shorter.length; i += 1) {
        if (shorter[i] !== longer[i]) return false;
    }
    return true;
}

// A suite registers when it contains something ticked, is ticked, or sits inside
// something ticked. The first of those three is why the outermost suite always
// registers: the ticked contexts cannot exist without their parent.
function shouldRegisterSuite(titlePath, selected) {
    if (!selected || selected.length === 0) return true;
    return selected.some((sel) => isPrefix(titlePath, sel) || isPrefix(sel, titlePath));
}

// A test registers only when it sits inside something ticked. Containing a ticked
// context is not enough, which is what keeps loose tests in the outermost suite out
// of a run that asked for one context.
function shouldRegisterTest(enclosingPath, selected) {
    if (!selected || selected.length === 0) return true;
    return selected.some((sel) => isPrefix(sel, enclosingPath));
}

module.exports = { isPrefix, shouldRegisterSuite, shouldRegisterTest };
