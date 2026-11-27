'use strict';

// Run this by hand to see what a terminal does with the redraw the list uses:
// move the cursor up over what was drawn, erase from there down, and draw again.
//
//   node test/manual/redraw-probe.js        the redraw the list uses today
//   node test/manual/redraw-probe.js alt    the same, on the alternate screen
//   node test/manual/redraw-probe.js keys   redraws on each key, and reports the cursor
//
// Three marker lines are printed first. A terminal that handles the redraw keeps
// all three, and the block below them stays put. Lines going missing, or the block
// climbing towards the top, is the fault being looked for.
//
// The alternate screen is the other way to draw a list: the terminal hands over a
// screen of its own, so there is nothing above the block to lose. That run waits for
// a key before handing the screen back, so there is time to look at it.

const stdout = process.stdout;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

const BLOCK = 24; // close to what the real list draws

function block(pass, lines) {
    const out = [];
    out.push('  pass ' + pass + ' head, line 1 of ' + lines);
    for (let i = 2; i < lines; i += 1) out.push('  pass ' + pass + ' line ' + i);
    out.push('  pass ' + pass + ' foot, line ' + lines);
    return out;
}

const mode = process.argv[2] || 'plain';

// Added by the keys mode: asks the terminal where its cursor is, before and after a
// key. The list's redraw moves up by the number of lines it wrote, so the cursor has
// to be exactly that far below the top of the drawing. Anything that moves it in
// between, such as a terminal echoing the key, breaks the next draw.
const DSR = '\u001b[6n';

// The answer to DSR arrives on stdin, mixed in with whatever keys were pressed.
function cursorRow(stdin, stdout) {
    return new Promise((done) => {
        let held = '';
        let finish = done;
        const onData = (chunk) => {
            held += chunk.toString();
            const m = /\u001b[[](\d+);(\d+)R/.exec(held);
            if (!m) return;
            stdin.removeListener('data', onData);
            finish({ row: Number(m[1]), col: Number(m[2]), extra: held.replace(m[0], '') });
        };
        // A terminal that does not answer must not leave this waiting for ever.
        const giveUp = setTimeout(() => {
            stdin.removeListener('data', onData);
            done({ row: 0, col: 0, extra: held, unanswered: true });
        }, 1000);
        finish = (answer) => { clearTimeout(giveUp); done(answer); };
        stdin.on('data', onData);
        stdout.write(DSR);
    });
}

// One key, ignoring any late answer to a DSR.
function nextKey(stdin) {
    return new Promise((done) => {
        const onData = (chunk) => {
            const text = chunk.toString().replace(/\u001b[[]\d+;\d+R/g, '');
            if (text.length === 0) return;
            stdin.removeListener('data', onData);
            done(text);
        };
        stdin.on('data', onData);
    });
}

async function keys() {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (!stdin.isTTY) {
        console.log('this mode needs a terminal. Run it in the terminal itself, not through a pipe.');
        return;
    }
    const trace = [];
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write('\u001b[?25l');

    console.log('MARKER A: this line must stay');
    console.log('MARKER B: this line must stay');
    console.log('MARKER C: this line must stay');

    let drawn = 0;
    let pass = 1;
    const paint = () => {
        const lines = BLOCK + pass - 1;
        if (drawn > 0) stdout.write('\u001b[' + drawn + 'A\u001b[0J');
        stdout.write(block(pass, lines).join('\n') + '\n');
        drawn = lines;
        return lines;
    };

    const lines = paint();
    const settled = await cursorRow(stdin, stdout);
    trace.push(settled.unanswered
        ? 'after the first draw of ' + lines + ' lines, the terminal did not say where its cursor is'
        : 'after the first draw of ' + lines + ' lines, the cursor is on row ' + settled.row
            + ', column ' + settled.col);

    for (let i = 0; i < 6; i += 1) {
        const key = await nextKey(stdin);
        if (key === 'q' || key === String.fromCharCode(3)) break;
        const before = await cursorRow(stdin, stdout);
        const expected = settled.row + (pass - 1); // each pass so far added one line
        trace.push('key ' + JSON.stringify(key) + ': the cursor is on row ' + before.row
            + ', expected ' + expected + (before.row === expected ? '' : '   <-- moved')
            + (before.extra ? '   stray bytes ' + JSON.stringify(before.extra) : ''));
        pass += 1;
        const drew = paint();
        const after = await cursorRow(stdin, stdout);
        trace.push('   drew ' + drew + ' lines, the cursor is now on row ' + after.row
            + ', expected ' + (before.row + 1));
    }

    stdin.setRawMode(false);
    stdin.pause();
    stdout.write('\u001b[?25h');
    console.log('');
    console.log('rows=' + stdout.rows + ' columns=' + stdout.columns);
    trace.forEach((line) => console.log(line));
    console.log('the markers must still be above the block, and every row must be the expected one.');
}


const ALT_ON = '\u001b[?1049h';
const ALT_OFF = '\u001b[?1049l';
const HOME = '\u001b[H';
const CLEAR_DOWN = '\u001b[0J';

// Waits for one key, so the alternate screen can be looked at before it goes.
function anyKey() {
    return new Promise((done) => {
        const stdin = process.stdin;
        if (!stdin.isTTY) return done();
        stdin.setRawMode(true);
        stdin.resume();
        stdin.once('data', () => { stdin.setRawMode(false); stdin.pause(); done(); });
    });
}

async function alternate() {
    process.stdout.write(ALT_ON);
    for (let pass = 1; pass <= 4; pass += 1) {
        const lines = BLOCK + pass - 1;
        process.stdout.write(HOME + CLEAR_DOWN + block(pass, lines).join('\n') + '\n');
        await wait(700);
    }
    process.stdout.write('\n  press any key to hand the screen back\n');
    await anyKey();
    process.stdout.write(ALT_OFF);
    console.log('the alternate screen is handed back. Everything that was here before should be back.');
}

(async () => {
    if (mode === 'alt') return alternate();
    if (mode === 'keys') return keys();
    console.log('MARKER A: this line must stay');
    console.log('MARKER B: this line must stay');
    console.log('MARKER C: this line must stay');

    let drawn = 0;
    for (let pass = 1; pass <= 4; pass += 1) {
        const lines = BLOCK + pass - 1; // each pass is one line taller, as adding the search line is
        if (drawn > 0) stdout.write('\u001b[' + drawn + 'A\u001b[0J');
        stdout.write(block(pass, lines).join('\n') + '\n');
        drawn = lines;
        await wait(700);
    }

    console.log('');
    console.log('reported size: rows=' + stdout.rows + ' columns=' + stdout.columns
        + '  isTTY=' + Boolean(stdout.isTTY) + '  TERM=' + (process.env.TERM || 'unset')
        + '  TERM_PROGRAM=' + (process.env.TERM_PROGRAM || 'unset'));
    console.log('the block above should read "pass 4" on every line, with the three markers kept.');
})();
