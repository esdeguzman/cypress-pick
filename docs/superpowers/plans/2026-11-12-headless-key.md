# Headless Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `r` to the spec list as a second way to accept, which runs the ticked picks through Cypress and never shows the "How should it run?" list.

> **The key changed after this plan was written and executed.** Every task below
> was carried out with `h`, then swapped to `r` in one commit at the end, because
> `h` was already the vim key for closing an open spec. The code, the tests and
> the README all say `r`. The step bodies below still say `h`, because they are a
> record of what was done at the time. Where they disagree with the code, the
> code is right.

**Architecture:** `promptList` gains a third outcome. It already resolves `null` for quit and the state for accept; it will now resolve `{ state, accept }` where `accept` is `'ask'` or `'headless'`. A new option, `allowHeadless`, decides whether `r` is bound to the headless accept and whether the footer names it. `cli.js` reads `accept` and, when it is `'headless'`, uses the same `{ how: { kind: 'cypress' }, message: null }` value it already uses for a project with no runnable scripts.

**Tech Stack:** Node 18 or later, CommonJS, `node --test`, no production dependencies.

Design document: `docs/superpowers/specs/2026-11-12-headless-key-design.md`.

## Global Constraints

Every task's requirements implicitly include this section.

- **No runtime dependencies.** No `dependencies` block in `package.json`.
- **CommonJS.** No `"type": "module"`.
- **Node 18 or later.**
- **Four space indent, single quotes, semicolons.** Match the files being edited.
- **Nothing in `src/list-state.js`, `src/build-args.js`, `src/run.js` or `runner.js` changes.**
- **Writing style, applies to every comment, message and document.** Plain language aimed at someone who is not a developer. Short sentences. No em dashes or en dashes, use a period, a comma or a colon. State what happens rather than reaching for a figure of speech: no "silently", "under the hood", "sanity check", "smoking gun". A comment explains why the code is written that way, not what it does. Expand an abbreviation the first time it appears in a file.
- **Every commit message ends with:** `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **The whole suite must pass after every task:** `npm test`

## File map

| File | What changes |
|---|---|
| `src/checkbox-list.js` | Resolved shape becomes `{ state, accept }`. New `allowHeadless` option binds `r` and adds a footer entry |
| `src/cli.js` | Both `promptList` call sites read `state` out of the result. The spec list asks for `allowHeadless`. A headless accept skips `chooseHow` |
| `test/checkbox-list.test.js` | Existing accept tests read `state` out of the result. New tests for `r`, for `h` keeping close, for `accept`, and for the footer |
| `test/cli.test.js` | New end to end `main` tests for the headless path |
| `test/manual/demo-list.js` | Reads `state` out of the result |
| `README.md` | The sample key list, and the section "Two ways it runs" |
| `docs/superpowers/plans/2026-11-11-cypress-pick.md` | The file map note for `src/checkbox-list.js` |

---

## Task 1: promptList resolves an object

Changes what `promptList` resolves, with no change to what any key does. Splitting this from the new key keeps the churn across the existing tests away from the behaviour change in Task 2.

**Files:**
- Modify: `src/checkbox-list.js:116-120`
- Modify: `src/cli.js:98-106`, `src/cli.js:155`
- Modify: `test/checkbox-list.test.js` (every test that reads the resolved value)
- Modify: `test/manual/demo-list.js:27-35`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `promptList(state, options)` resolves `null` when the person pressed `q` or Ctrl+C, and `{ state, accept }` otherwise, where `state` is the list state and `accept` is the string `'ask'`.

- [x] **Step 1: Write the failing test**

Add to `test/checkbox-list.test.js`, just after the existing test named `enter resolves with the state as it stands`:

```js
test('enter resolves with an accept of ask alongside the state', async () => {
    const { stdin, stdout } = fakeTerminal();
    const resultPromise = promptList(createState(SCANNED), { title: 't', stdin, stdout });
    stdin.write(' '); // tick spec a, so the state carried back is not the start state
    stdin.write('\r');
    const result = await resultPromise;
    assert.equal(result.accept, 'ask');
    assert.equal(visibleRows(result.state)[0].mark, 'x');
});
```

- [x] **Step 2: Run it to make sure it fails**

Run: `node --test test/checkbox-list.test.js`

Expected: FAIL. `result.accept` is `undefined`, because `promptList` resolves the state itself and a list state has no `accept` property.

- [x] **Step 3: Change what promptList resolves**

In `src/checkbox-list.js`, inside `handleKey`, replace the accept branch:

```js
            if (ACCEPT_KEYS.includes(text)) {
                restore();
                resolve(current);
                return true;
            }
```

with:

```js
            if (ACCEPT_KEYS.includes(text)) {
                restore();
                resolve({ state: current, accept: 'ask' });
                return true;
            }
```

Add this sentence to the end of the comment block directly above the `promptList` function:

```
// Quitting resolves null. Accepting resolves { state, accept }, because there is
// more than one way to accept and the caller has to be able to tell them apart.
```

- [x] **Step 4: Run the new test to make sure it passes**

Run: `node --test test/checkbox-list.test.js`

Expected: the new test PASSES. Several other tests in the file now FAIL, because they read the resolved value as a state. Fix them in the next step.

- [x] **Step 5: Update the existing tests in `test/checkbox-list.test.js`**

Every test that accepts with `\r` or `\n` and then uses the resolved value must take `state` out of the result. Change the line

```js
    const state = await resultPromise;
```

to

```js
    const { state } = await resultPromise;
```

in each of these tests:

- `moving down and ticking with space checks the second spec`
- `opening a spec with the right arrow then ticking one context`
- `enter resolves with the state as it stands`
- `an unknown key changes nothing`
- `the up arrow moves the cursor up`
- `the left arrow closes an open spec`
- `a split up arrow, the escape byte then the rest in a second chunk, moves the cursor instead of quitting`
- `a split down arrow, the escape and the bracket then the letter in a second chunk, moves the cursor`
- `a held escape byte followed by an unrelated key is dropped, not quitting and changing nothing`

In `a ticks everything and n unticks everything`, change the two result lines. This:

```js
    const tickedAll = await resultPromise;
```

becomes:

```js
    const { state: tickedAll } = await resultPromise;
```

and this:

```js
    const untickedAll = await resultPromise2;
```

becomes:

```js
    const { state: untickedAll } = await resultPromise2;
```

Leave these tests exactly as they are. They either compare the result to `null`, which must not be destructured, or never read the resolved value at all:

- `q quits and resolves to null`
- `Ctrl+C quits and resolves to null`
- `a redraw rewinds the screen by exactly the number of lines drawn last time`
- `the cursor is shown again after quitting with q`
- `the cursor is shown again after accepting with enter`
- `the cursor is shown again after Ctrl+C`
- `an exception inside the key handler still restores the terminal before the promise rejects`
- `an error event on stdin still restores the terminal before the promise rejects`

- [x] **Step 6: Run the file again**

Run: `node --test test/checkbox-list.test.js`

Expected: PASS, every test.

- [x] **Step 7: Update both call sites in `src/cli.js`**

In `chooseHow`, replace:

```js
    const state = await promptList(createState(choices), {
        title: 'How should it run? Move to one, press space, then enter.',
        stdout,
        stdin,
    });
    if (!state) return null;
    return decideHow(state, scripts);
```

with:

```js
    const picked = await promptList(createState(choices), {
        title: 'How should it run? Move to one, press space, then enter.',
        stdout,
        stdin,
    });
    if (!picked) return null;
    return decideHow(picked.state, scripts);
```

In `main`, replace:

```js
    const state = await promptList(createState(scanned), { title, stdout, stdin });
    if (!state) { stdout.write('\n  Nothing run.\n'); return 0; }
```

with:

```js
    const picked = await promptList(createState(scanned), { title, stdout, stdin });
    if (!picked) { stdout.write('\n  Nothing run.\n'); return 0; }
    const state = picked.state;
```

- [x] **Step 8: Update `test/manual/demo-list.js`**

Replace the opening of the final block:

```js
promptList(createState(scanned), { title: 'demo, nothing will run' }).then((state) => {
    if (!state) {
        console.log('quit');
        return;
    }
```

with:

```js
promptList(createState(scanned), { title: 'demo, nothing will run' }).then((picked) => {
    if (!picked) {
        console.log('quit');
        return;
    }
    const state = picked.state;
```

- [x] **Step 9: Run the whole suite**

Run: `npm test`

Expected: PASS, every file. No behaviour has changed yet, so a failure here is a missed call site.

- [x] **Step 10: Commit**

```bash
git add src/checkbox-list.js src/cli.js test/checkbox-list.test.js test/manual/demo-list.js
git commit -m "refactor: promptList resolves the state and how it was accepted

There is about to be more than one way to accept, so the caller has to be
able to tell them apart. Quitting still resolves null.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: the h key and the footer entry

Adds the key itself, behind an option, so the "How should it run?" list is not affected.

**Files:**
- Modify: `src/checkbox-list.js` (the `KEYS` map, `renderLines`, `handleKey`, and `promptList`'s options)
- Modify: `test/checkbox-list.test.js`

**Interfaces:**
- Consumes: `promptList(state, options)` resolving `{ state, accept }` from Task 1.
- Produces: `promptList(state, { allowHeadless: true, ... })`. With the option on, `h` resolves `{ state, accept: 'headless' }` and the footer reads `  enter run   r headless   q quit`. With the option off or missing, `h` keeps its current meaning, close, and the footer reads `  enter run   q quit`. `renderLines(state, { title, allowHeadless })` takes the same option.

- [x] **Step 1: Write the failing tests**

Add all four to the end of `test/checkbox-list.test.js`. Escape sequences are written as `\u001b`, matching the rest of the file:

```js
// h accepts and asks for a headless run, which is cypress run with no second
// question about how to run. It replaces h as a close key, which the left arrow
// still does. The option exists because the same widget draws the "How should it
// run?" list, where a headless key would mean nothing.

test('h with allowHeadless resolves an accept of headless, carrying the ticks as they stood', async () => {
    const { stdin, stdout } = fakeTerminal();
    const resultPromise = promptList(createState(SCANNED), { title: 't', stdin, stdout, allowHeadless: true });
    stdin.write(' '); // tick spec a
    stdin.write('h');
    const result = await resultPromise;
    assert.equal(result.accept, 'headless');
    assert.equal(visibleRows(result.state)[0].mark, 'x', 'the tick made before h is in the resolved state');
});

test('h without allowHeadless still closes an open spec', async () => {
    const { stdin, stdout } = fakeTerminal();
    const resultPromise = promptList(createState(SCANNED), { title: 't', stdin, stdout });
    stdin.write('\u001b[C'); // open spec a, its contexts are now drawn
    stdin.write('h'); // close it again
    stdin.write('\r');
    const { state } = await resultPromise;
    assert.deepEqual(visibleRows(state).map((r) => r.kind), ['spec', 'spec'], 'the contexts are hidden again');
});

test('the footer names the headless key only when the option is on', () => {
    const withKey = renderLines(createState(SCANNED), { title: 't', allowHeadless: true });
    assert.ok(withKey.some((l) => l.includes('r headless')));

    const withoutKey = renderLines(createState(SCANNED), { title: 't' });
    assert.ok(!withoutKey.some((l) => l.includes('r headless')));
    assert.ok(withoutKey.some((l) => l.includes('enter run')), 'the rest of the footer is unchanged');
});

test('the cursor is shown again after accepting with h', async () => {
    const { stdin, stdout, written } = fakeTerminal();
    const resultPromise = promptList(createState(SCANNED), { title: 't', stdin, stdout, allowHeadless: true });
    stdin.write('h');
    await resultPromise;
    assert.equal(written[written.length - 1], '\u001b[?25h');
});
```

- [x] **Step 2: Run them to make sure they fail**

Run: `node --test test/checkbox-list.test.js`

Expected: three FAIL and one PASSES. `h with allowHeadless...` fails because `h` closes instead of accepting, so the promise never settles and the test times out. `the footer names the headless key only when the option is on` fails because no footer line contains `h headless`. `the cursor is shown again after accepting with h` fails the way the first one does. `h without allowHeadless still closes an open spec` passes already, which is the point of it: it is there to catch the option leaking into the other list later.

- [x] **Step 3: Add the key, the footer entry and the option**

In `src/checkbox-list.js`, remove the `h: 'close'` entry from the `KEYS` map, leaving the other vim keys alone. The map becomes:

```js
const KEYS = {
    '\u001b[A': 'up',
    '\u001b[B': 'down',
    '\u001b[C': 'open',
    '\u001b[D': 'close',
    k: 'up',
    j: 'down',
    l: 'open',
    ' ': 'toggle',
    a: 'all',
    n: 'none',
};
```

Directly below the `KEYS` map, add:

```js
// h accepts and asks for a headless run. It used to close an open spec, which the
// left arrow still does, and which is why the letter was affordable to take. Only
// the spec list binds it: the same widget draws the "How should it run?" list,
// where there is nothing for a headless key to mean, so there it still closes.
const HEADLESS_KEY = 'h';
```

In `renderLines`, replace the signature:

```js
function renderLines(state, { title, width = 78 } = {}) {
```

with:

```js
function renderLines(state, { title, width = 78, allowHeadless = false } = {}) {
```

and replace the last footer line:

```js
    lines.push('  enter run   q quit');
```

with:

```js
    lines.push(allowHeadless ? '  enter run   r headless   q quit' : '  enter run   q quit');
```

In `promptList`, replace the signature:

```js
function promptList(state, { title, stdin = process.stdin, stdout = process.stdout } = {}) {
```

with:

```js
function promptList(state, { title, stdin = process.stdin, stdout = process.stdout, allowHeadless = false } = {}) {
```

In `promptList`'s `draw`, pass the option through. Replace:

```js
            const lines = renderLines(current, { title });
```

with:

```js
            const lines = renderLines(current, { title, allowHeadless });
```

In `handleKey`, add the headless branch directly after the existing accept branch, above the `KEYS` lookup. The result reads:

```js
            if (ACCEPT_KEYS.includes(text)) {
                restore();
                resolve({ state: current, accept: 'ask' });
                return true;
            }
            if (text === HEADLESS_KEY) {
                if (allowHeadless) {
                    restore();
                    resolve({ state: current, accept: 'headless' });
                    return true;
                }
                current = reduce(current, 'close');
                draw();
                return true;
            }
            const action = KEYS[text];
```

Add `HEADLESS_KEY` to the exports:

```js
module.exports = { renderLines, promptList, KEYS, QUIT_KEYS, ACCEPT_KEYS, HEADLESS_KEY };
```

- [x] **Step 4: Run the file to make sure every test passes**

Run: `node --test test/checkbox-list.test.js`

Expected: PASS, every test, including the ones updated in Task 1.

- [x] **Step 5: Run the whole suite**

Run: `npm test`

Expected: PASS. `cli.js` does not pass `allowHeadless` yet, so nothing it does has changed.

- [x] **Step 6: Commit**

```bash
git add src/checkbox-list.js test/checkbox-list.test.js
git commit -m "feat: h accepts and asks for a headless run

Behind an option, so only the spec list binds it. h no longer closes an
open spec there; the left arrow still does.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: cli.js skips the mode list on a headless accept

**Files:**
- Modify: `src/cli.js:155`, `src/cli.js:175-180`
- Modify: `test/cli.test.js`

**Interfaces:**
- Consumes: `promptList(state, { allowHeadless: true, ... })` resolving `{ state, accept }` from Task 2.
- Produces: no new exported function. `main` runs Cypress without drawing the "How should it run?" list when `accept` is `'headless'`.

- [x] **Step 1: Write the failing tests**

Add `PassThrough` to the requires at the top of `test/cli.test.js`, below the existing `path` require:

```js
const { PassThrough } = require('node:stream');
```

Then add to the end of the file:

```js
// The headless key runs Cypress and never draws the mode list. The project built
// here has a runnable script, so pressing enter instead would have drawn it.
// Cypress is not installed in a temporary folder, so the run stops there and the
// exit code is 1. The spec is ticked first, so that 1 can only have come from the
// Cypress path: the other way to get a 1 is the refusal for nothing ticked, and
// that message is checked for and must not be there.
//
// The "Cypress is not installed" line itself is not checked, because runCypress
// writes it to process.stdout rather than to the stdout passed in, so it never
// reaches the array below.

function fakeTty() {
    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => {};
    return stdin;
}

function tinyProject() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cypick-headless-'));
    fs.mkdirSync(path.join(dir, 'cypress', 'e2e'), { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'cypress.config.js'),
        "module.exports = { e2e: { specPattern: 'cypress/e2e/**/*.cy.js' } };\n"
    );
    fs.writeFileSync(
        path.join(dir, 'cypress', 'e2e', 'one.cy.js'),
        "describe('Root', () => { it('works', () => {}); });\n"
    );
    fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'tiny', scripts: { headless: 'cypress run' } })
    );
    return dir;
}

test('h runs cypress and never draws the mode list', async () => {
    const dir = tinyProject();
    const stdin = fakeTty();
    const written = [];
    const codePromise = main([], {
        cwd: dir,
        stdout: { write: (text) => written.push(text) },
        stdin,
    });

    await new Promise((resolve) => setImmediate(resolve)); // let the first draw happen
    stdin.write(' '); // tick the one spec
    stdin.write('h');

    const code = await codePromise;
    const output = written.join('');
    assert.ok(!output.includes('How should it run?'), 'the mode list was never drawn');
    assert.ok(!output.includes('Nothing was ticked'), 'the spec was ticked, so this is not the refusal');
    assert.equal(code, 1, 'the run reached Cypress, which is not installed in a temporary folder');
});

test('h with nothing ticked refuses, the same way enter does', async () => {
    const dir = tinyProject();
    const stdin = fakeTty();
    const written = [];
    const codePromise = main([], {
        cwd: dir,
        stdout: { write: (text) => written.push(text) },
        stdin,
    });

    await new Promise((resolve) => setImmediate(resolve));
    stdin.write('h'); // no tick first

    const code = await codePromise;
    assert.match(written.join(''), /Nothing was ticked, so nothing was run/);
    assert.equal(code, 1);
});
```

- [x] **Step 2: Run them to make sure they fail**

Run: `node --test test/cli.test.js`

Expected: `h runs cypress and never draws the mode list` FAILS. `h` is not bound in the spec list yet, so it closes nothing, the promise never settles, and the test times out. `h with nothing ticked refuses` fails the same way.

- [x] **Step 3: Turn the option on and read the accept**

In `src/cli.js`, in `main`, replace:

```js
    const picked = await promptList(createState(scanned), { title, stdout, stdin });
```

with:

```js
    const picked = await promptList(createState(scanned), { title, stdout, stdin, allowHeadless: true });
```

Then replace:

```js
    const scripts = runnableScripts(hostPackage);
    const outcome = scripts.length === 0
        ? { how: { kind: 'cypress' }, message: null }
        : await chooseHow(scripts, { stdout, stdin });
```

with:

```js
    const scripts = runnableScripts(hostPackage);
    // The headless key is an answer to the question chooseHow asks, given before it
    // was asked, so the question is not asked. It is the same answer a project with
    // no runnable scripts gets, which is why both reach the same value here.
    const skipTheQuestion = picked.accept === 'headless' || scripts.length === 0;
    const outcome = skipTheQuestion
        ? { how: { kind: 'cypress' }, message: null }
        : await chooseHow(scripts, { stdout, stdin });
```

- [x] **Step 4: Run the file to make sure the tests pass**

Run: `node --test test/cli.test.js`

Expected: PASS, every test.

- [x] **Step 5: Run the whole suite**

Run: `npm test`

Expected: PASS, every file.

- [x] **Step 6: Commit**

```bash
git add src/cli.js test/cli.test.js
git commit -m "feat: h in the spec list runs the picks without asking how

The headless key answers the question about how to run before it is asked,
so the mode list is skipped and Cypress is started directly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: documentation

**Files:**
- Modify: `README.md:21-22`, `README.md` section "Two ways it runs"
- Modify: `docs/superpowers/plans/2026-11-11-cypress-pick.md` (the file map row for `src/checkbox-list.js`)

**Interfaces:**
- Consumes: the finished behaviour from Task 3.
- Produces: nothing other tasks use.

- [x] **Step 1: Update the sample list in `README.md`**

Replace these two lines:

```
  up/down move   space tick   right open   left close   a all   n none
  enter run   q quit
```

with:

```
  up/down move   space tick   right open   left close   a all   n none
  enter run   r headless   q quit
```

- [x] **Step 2: Update the section "Two ways it runs" in `README.md`**

Replace its opening sentence:

```
After you press enter it asks how to run. **Run Cypress directly** needs no setup and
builds the command itself:
```

with:

```
After you press enter it asks how to run. Press `h` instead of enter and it does not
ask: it runs Cypress directly, which is the first of the two answers below. **Run
Cypress directly** needs no setup and builds the command itself:
```

- [x] **Step 3: Say what the h binding replaced**

At the end of the "Two ways it runs" section, after the paragraph about the `CYPICK_` variable names, add:

```
`h` used to close an open spec. The left arrow still does that, and `j`, `k` and `l`
still move down, move up and open.
```

- [x] **Step 4: Update the file map in the original plan**

In `docs/superpowers/plans/2026-11-11-cypress-pick.md`, replace the file map row:

```
| `src/checkbox-list.js` | Draws the list and reads keys. The only module that touches the terminal |
```

with:

```
| `src/checkbox-list.js` | Draws the list and reads keys. The only module that touches the terminal. Resolves `{ state, accept }`, where `accept` is `ask` or `headless` |
```

- [x] **Step 5: Check the README against the real footer**

Run: `node --test test/checkbox-list.test.js`

Expected: PASS. Then read the string in `src/checkbox-list.js` that `renderLines` pushes when `allowHeadless` is true, and confirm it matches the README sample character for character, spacing included. A README that shows a different footer from the one the command draws is the failure this step exists to catch.

- [x] **Step 6: Run the whole suite and commit**

Run: `npm test`

Expected: PASS.

```bash
git add README.md docs/superpowers/plans/2026-11-11-cypress-pick.md
git commit -m "docs: the headless key in the README and the file map

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Status

| Task | State |
|---|---|
| 1. promptList resolves an object | done, committed as f47a22a |
| 2. The h key and the footer entry | done, committed as 05e5433 |
| 3. cli.js skips the mode list | done, committed as 758aebd |
| 4. Documentation | done, committed as e465c94 |

**Next:** nothing. Every task is done.

**In flight:** nothing.

## Decisions already settled

- **The key is `r`, and nothing loses its meaning.** `h` was chosen first, for the word headless, and swapped out once it was clear `h` was already the vim close key. `r` was free, so every existing key still does what it did.
- **It runs `cypress run` directly.** No `--headless` flag is added, because `cypress run` is already headless, and no npm script is involved.
- **It runs whatever is ticked**, not the row under the cursor. The only difference from enter is that the mode list is skipped.
- **The mode list does not bind the key.** Hence the `allowHeadless` option rather than a change to the shared `KEYS` map.
