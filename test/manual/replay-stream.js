'use strict';

// Writes a recording made with CYPRESS_PICK_TRACE back to the terminal, byte for
// byte, with no list logic in the way. It steps on a key press, so each draw can be
// looked at.
//
//   node test/manual/replay-stream.js <recording> [--no-color] [--no-wrap-off] [--short]
//
// The switches take one thing out of the stream at a time: --no-color drops the
// reverse video and green, --no-wrap-off drops the request to stop wrapping, and
// --short cuts every drawn line to 30 characters. Whichever switch makes the pinning
// go away names the cause.

const fs = require('node:fs');
const entries = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const flags = process.argv.slice(3);
const has = (flag) => flags.includes(flag);

const ESC = String.fromCharCode(27);
const SGR = new RegExp(ESC + '[[](?:7|32|0)m', 'g');

function tidy(text) {
    let out = text;
    if (has('--no-color')) out = out.replace(SGR, '');
    if (has('--no-wrap-off')) out = out.split(ESC + '[?7l').join('').split(ESC + '[?7h').join('');
    if (has('--short')) {
        out = out.split('\n').map((line) => (line.length > 30 ? line.slice(0, 30) : line)).join('\n');
    }
    return out;
}

function anyKey() {
    return new Promise((done) => {
        const stdin = process.stdin;
        if (!stdin.isTTY) return done();
        stdin.setRawMode(true);
        stdin.resume();
        stdin.once('data', (chunk) => {
            stdin.setRawMode(false);
            stdin.pause();
            done(chunk.toString());
        });
    });
}

(async () => {
    console.log('MARKER A: this line must stay');
    console.log('MARKER B: this line must stay');
    console.log('MARKER C: this line must stay');
    console.log('replaying ' + process.argv[2] + ' ' + flags.join(' '));
    console.log('press a key for each draw, or q to stop');

    for (const entry of entries) {
        if (entry.write === undefined) continue;
        const text = tidy(entry.write);
        if (text.indexOf('\n') !== -1) {
            const key = await anyKey();
            if (key === 'q' || key === String.fromCharCode(3)) break;
        }
        process.stdout.write(text);
    }

    process.stdout.write(ESC + '[?25h' + ESC + '[?7h');
    console.log('');
    console.log('replay done. rows=' + process.stdout.rows + ' columns=' + process.stdout.columns);
    console.log('the three markers must still be above the drawing.');
})();
