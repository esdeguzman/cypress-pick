'use strict';

// How the picked contexts travel from the command line into the browser.
//
// The value goes on Cypress's --expose flag, which is written as key=value and is
// split at commas when more than one value is given. JavaScript Object Notation
// (JSON) contains both commas and quotes, so it is encoded first. base64url is used
// rather than plain base64 because plain base64 pads with the equals sign, which is
// the same character that separates the key from the value on that flag.

// Node only. The picker runs in Node, so nothing in the browser needs to encode.
function encode(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

// Runs in Node and in the browser, so it uses atob rather than Buffer. Node has had
// atob as a global since version 16.
function decode(text) {
    if (!text || typeof text !== 'string') return null;
    try {
        const padded = text.replace(/-/g, '+').replace(/_/g, '/');
        const base64 = padded + '='.repeat((4 - (padded.length % 4)) % 4);
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (err) {
        // A filter that cannot be read means the run was not started by the picker,
        // or the value was damaged on the way. Either way the right answer is to run
        // everything rather than to stop the run.
        return null;
    }
}

module.exports = { encode, decode };
