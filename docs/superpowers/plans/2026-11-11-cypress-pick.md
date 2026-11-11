# cypress-pick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `cypress-pick`, a command that lists a Cypress project's specs and the context blocks inside them, lets you tick the ones you want, and runs only those without editing any spec file.

**Architecture:** A Node command line tool with no runtime dependencies. It scans spec files for their `describe` and `context` blocks, shows a two level checkbox list, then launches Cypress with `--spec` for the file level and a base64url encoded filter on `--expose` for the context level. A small file that the host project imports into its Cypress support file reads that filter in the browser and stops unticked contexts from registering. The matching rule lives in one module used by both sides.

**Tech Stack:** Node 18 or later, CommonJS, `node --test` for tests, no production dependencies.

Design document: `docs/superpowers/specs/2026-11-11-cypress-pick-design.md`.

## Global Constraints

Every task's requirements implicitly include this section.

- **No runtime dependencies.** `package.json` has no `dependencies` block. Dev dependencies are allowed but none are needed.
- **CommonJS.** No `"type": "module"`. The host project may be either, and CommonJS is readable from both.
- **Node 18 or later**, declared in `engines`. That is the floor for `Buffer.from(s, 'base64url')` and global `atob`.
- **Cypress 16 and above uses `--expose cypressPick=<value>` and `Cypress.expose('cypressPick')`. Below 16 uses `--env cypressPick=<value>` and `Cypress.env('cypressPick')`.** Cypress 16 removed `Cypress.env()`.
- **The encoded filter is base64url with no padding.** Standard base64 padding is `=`, and the flag is already `key=value`, so padding can break how the value is parsed. Cypress also splits these flags at commas, which raw JSON contains.
- **Environment variables are named `CYPICK_SPEC`, `CYPICK_FILTER` and `CYPICK_FLAG`.** Never the `CYPRESS_` prefix, which Cypress claims for its own config and env overrides.
- **No spec file in a host project is ever edited, moved or written to.**
- **Writing style, applies to every comment, message and document.** Plain language aimed at someone who is not a developer. Short sentences. No em dashes or en dashes, use a period, a comma or a colon. State what happens rather than reaching for a figure of speech: no "silently", "under the hood", "sanity check", "smoking gun". A comment explains why the code is written that way, not what it does. Expand an abbreviation the first time it appears in a file.
- **Every commit message ends with:** `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File map

| File | Responsibility |
|---|---|
| `package.json` | Name, `bin`, `exports`, `engines`, `files` |
| `bin/cypress-pick.js` | The command. Calls into `src/cli.js` and nothing else |
| `src/cli.js` | Reads flags, calls the other modules in order, launches the run |
| `src/spec-scan.js` | Finds spec files and reads the suites inside them |
| `src/host-config.js` | Reads the host project's Cypress config, support file and Cypress version |
| `src/list-state.js` | Current state plus a key gives the next state. Plain functions |
| `src/checkbox-list.js` | Draws the list and reads keys. The only module that touches the terminal |
| `src/npm-scripts.js` | Reads the host project's `package.json` scripts |
| `src/filter-codec.js` | Encodes and decodes the filter. Used by Node and by the browser |
| `src/build-args.js` | A selection gives Cypress arguments. Plain functions |
| `src/match.js` | A title path plus a selection gives true or false. Plain functions |
| `src/run.js` | Starts Cypress or an npm script and returns its exit code |
| `support/index.js` | The browser side filter. Host projects import this |
| `runner.js` | `applyPick`, for host projects whose own runner script builds the arguments |

One change from the design document's own file list, made here on purpose: finding spec files is in `src/host-config.js` rather than in `src/spec-scan.js`. Finding files means reading the host's config and matching globs, and reading a spec file means parsing JavaScript. They are two jobs, and splitting them keeps each file small enough to hold in mind at once.

---

### Task 1: Package skeleton, and prove the flag reaches the browser

The whole design rests on a value put on the `cypress run` command line being readable in the browser while a spec file is still being read. Nothing else is worth building until that is confirmed on the real target, which is Cypress 16.1.0 as installed in `konjuur-cypress`.

**Files:**
- Create: `package.json`
- Create: `.gitignore` (already exists, confirm it ignores `node_modules/`)
- Create: `docs/spike-expose.md`
- Create then delete in the host project: `C:\Users\User\Documents\code\konjuur-cypress\cypress\e2e\_expose-probe.cy.js`

**Interfaces:**
- Consumes: nothing
- Produces: the package identity used by every later task. Name `cypress-pick`, entry points `./support` and `./runner`, `bin` name `cypress-pick`.

- [ ] **Step 1: Back up the host project before touching it**

The spike writes a file into `konjuur-cypress`. Take the backup first, per the standing rule about project backups. `node_modules` is excluded because it is reinstallable and copying it is slow.

```bash
mkdir -p ~/.claude/project-backups/konjuur-cypress-2026-11-11-spike
cd /c/Users/User/Documents/code/konjuur-cypress
tar --exclude=node_modules --exclude=cypress/videos -cf ~/.claude/project-backups/konjuur-cypress-2026-11-11-spike/konjuur-cypress.tar .
ls -la ~/.claude/project-backups/konjuur-cypress-2026-11-11-spike/
```

Expected: a `.tar` file of a few megabytes.

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "cypress-pick",
  "version": "0.1.0",
  "description": "Tick the Cypress specs and contexts you want, then run only those",
  "license": "MIT",
  "author": "Esmeraldo de Guzman Jr",
  "type": "commonjs",
  "engines": {
    "node": ">=18"
  },
  "bin": {
    "cypress-pick": "bin/cypress-pick.js"
  },
  "exports": {
    ".": "./src/cli.js",
    "./support": "./support/index.js",
    "./runner": "./runner.js",
    "./package.json": "./package.json"
  },
  "files": [
    "bin",
    "src",
    "support",
    "runner.js",
    "README.md"
  ],
  "scripts": {
    "test": "node --test test/"
  },
  "keywords": [
    "cypress",
    "cypress-plugin",
    "test-runner",
    "interactive"
  ]
}
```

- [ ] **Step 3: Write the probe spec in the host project**

Create `C:\Users\User\Documents\code\konjuur-cypress\cypress\e2e\_expose-probe.cy.js`.

`skipLogin` is on because this probe never loads a page, and the project's global login hook would otherwise add a network round trip to every test. The three values cover the three things that could break the round trip: a plain word, a base64url string containing the `-` and `_` characters that base64url substitutes, and a long value.

```js
// Throwaway probe. Delete it once docs/spike-expose.md in the cypress-pick repo
// records the result. It checks one thing: whether a value put on the cypress run
// command line can be read in the browser while a spec file is still being read,
// which is what the whole picker depends on.
describe('expose probe', { expose: { skipLogin: true } }, () => {
    it('reports what the exposed value looks like', () => {
        cy.writeFile('cypress/_probe/expose.json', {
            readAtFileLoad: READ_AT_FILE_LOAD,
            readInsideTest: typeof Cypress.expose === 'function' ? Cypress.expose('cypressPick') : 'no expose function',
            hasEnvFunction: typeof Cypress.env === 'function',
            specRelative: Cypress.spec.relative,
        })
    })
})

// Read at the moment the file is parsed, which is before any test is registered.
// That timing is the point of the probe: the filter has to be available here, not
// just inside a test.
const READ_AT_FILE_LOAD = typeof Cypress.expose === 'function' ? Cypress.expose('cypressPick') : 'no expose function'
```

Note the constant is declared after the `describe` on purpose. `const` is hoisted into the file scope, and the `describe` callback runs during registration, which is after the whole file has been read. Reading it inside `cy.writeFile` proves the value survives to that point.

Correction to that note if the run fails with a reference error: move the `const` to the top of the file and re-run. The ordering is not what the probe is testing.

- [ ] **Step 4: Run the probe with a value on the flag**

The value is the base64url of `{"a":1}`, which is `eyJhIjoxfQ`. It contains no padding, so it also tests that assumption.

```bash
cd /c/Users/User/Documents/code/konjuur-cypress
npx cypress run --spec cypress/e2e/_expose-probe.cy.js --expose cypressPick=eyJhIjoxfQ 2>&1 | tail -30
cat cypress/_probe/expose.json
```

Expected: the test passes, and the file shows `readAtFileLoad` and `readInsideTest` both equal to `eyJhIjoxfQ`.

- [ ] **Step 5: Run it a second time with a value containing base64url's own characters**

```bash
cd /c/Users/User/Documents/code/konjuur-cypress
node -e "console.log(Buffer.from(JSON.stringify({'cypress/e2e/x.cy.js':[['Root','A. Card structure']]})).toString('base64url'))"
# take the printed value and use it below
npx cypress run --spec cypress/e2e/_expose-probe.cy.js --expose cypressPick=<printed value> 2>&1 | tail -20
cat cypress/_probe/expose.json
```

Expected: the value comes back byte for byte identical. Decode it with `node -e "console.log(Buffer.from('<value>','base64url').toString())"` and confirm the original object.

- [ ] **Step 6: Record the result**

Write `docs/spike-expose.md` in the `cypress-pick` repo. It must state, as plain fact and with the commands used: whether the value arrives at file load time, whether it arrives inside a test, whether base64url survives unchanged, what `Cypress.spec.relative` looks like including which way its slashes lean, and whether `Cypress.env` still exists on Cypress 16.

If the value does **not** arrive at file load time, stop and report back. The design's context filtering is not possible as written and the plan needs revisiting.

- [ ] **Step 7: Clean up the host project**

```bash
cd /c/Users/User/Documents/code/konjuur-cypress
rm -f cypress/e2e/_expose-probe.cy.js
rm -rf cypress/_probe
rm -rf cypress/results
git status --short
```

Expected: `git status --short` shows the same files it showed before the spike started and no new ones. `cypress/results` is removed because the probe run writes a mochawesome file there, and a stale file in that folder lands in the next generated report.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/User/Documents/code/cypress-pick
git add package.json docs/spike-expose.md .gitignore
git commit -m "$(cat <<'MSG'
feat: package skeleton, and the spike proving the filter reaches the browser

The whole design depends on a value on the cypress run command line being
readable while a spec file is still being parsed. Confirmed against Cypress
16.1.0. Result recorded in docs/spike-expose.md.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: The matching rule

The one rule that decides what runs. It is used in Node for tests and in the browser for real, so it is a plain function with no imports.

**Files:**
- Create: `src/match.js`
- Test: `test/match.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `isPrefix(shorter: string[], longer: string[]) => boolean`
  - `shouldRegisterSuite(titlePath: string[], selected: string[][]) => boolean`
  - `shouldRegisterTest(enclosingPath: string[], selected: string[][]) => boolean`

A **title path** is the chain of suite titles from the outermost one inward, for example `['KONJUUR-286 Forecasted Cost card', 'A. Card structure and static content']`. A **selection** is a list of those paths, one per ticked context.

- [ ] **Step 1: Write the failing tests**

Create `test/match.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isPrefix, shouldRegisterSuite, shouldRegisterTest } = require('../src/match');

const SELECTED = [['Projects', 'Pagination']];

test('isPrefix is true when every title matches in order', () => {
    assert.equal(isPrefix(['Projects'], ['Projects', 'Pagination']), true);
    assert.equal(isPrefix(['Projects', 'Pagination'], ['Projects', 'Pagination']), true);
});

test('isPrefix is false when a title differs or the shorter list is longer', () => {
    assert.equal(isPrefix(['Projects', 'Search'], ['Projects', 'Pagination']), false);
    assert.equal(isPrefix(['Projects', 'Pagination', 'Deep'], ['Projects', 'Pagination']), false);
});

test('the outermost suite registers, because a ticked context lives inside it', () => {
    assert.equal(shouldRegisterSuite(['Projects'], SELECTED), true);
});

test('a ticked context registers', () => {
    assert.equal(shouldRegisterSuite(['Projects', 'Pagination'], SELECTED), true);
});

test('a context nested inside a ticked one registers', () => {
    assert.equal(shouldRegisterSuite(['Projects', 'Pagination', 'Multi-page navigation'], SELECTED), true);
});

test('an unticked sibling does not register', () => {
    assert.equal(shouldRegisterSuite(['Projects', 'Search'], SELECTED), false);
});

test('a test inside a ticked context registers', () => {
    assert.equal(shouldRegisterTest(['Projects', 'Pagination'], SELECTED), true);
});

test('a test nested deeper inside a ticked context registers', () => {
    assert.equal(shouldRegisterTest(['Projects', 'Pagination', 'Multi-page navigation'], SELECTED), true);
});

test('a test sitting directly in the outermost suite does not register', () => {
    // The outermost suite has to register so its ticked children can run. Without
    // this rule its own loose tests would run too, which is not what was ticked.
    assert.equal(shouldRegisterTest(['Projects'], SELECTED), false);
});

test('a test in an unticked sibling does not register', () => {
    assert.equal(shouldRegisterTest(['Projects', 'Search'], SELECTED), false);
});

test('an empty selection registers everything', () => {
    assert.equal(shouldRegisterSuite(['Projects', 'Search'], []), true);
    assert.equal(shouldRegisterTest(['Projects'], []), true);
});

test('two ticked contexts both register and their siblings do not', () => {
    const two = [['Root', 'A'], ['Root', 'C']];
    assert.equal(shouldRegisterSuite(['Root', 'A'], two), true);
    assert.equal(shouldRegisterSuite(['Root', 'C'], two), true);
    assert.equal(shouldRegisterSuite(['Root', 'B'], two), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/match.test.js
```

Expected: FAIL, cannot find module `../src/match`.

- [ ] **Step 3: Write the implementation**

Create `src/match.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/match.test.js
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/match.js test/match.test.js
git commit -m "$(cat <<'MSG'
feat: the rule deciding which suites and tests run

A suite registers when it contains a ticked context, is one, or sits inside
one. A test registers only when it sits inside a ticked context, which keeps
loose tests in the outermost suite out of a narrowed run.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: Encoding the filter for the command line

**Files:**
- Create: `src/filter-codec.js`
- Test: `test/filter-codec.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `encode(value: object) => string` base64url, no padding. Node only, uses `Buffer`
  - `decode(text: string) => object | null` works in Node and in the browser, uses `atob` and `TextDecoder`

- [ ] **Step 1: Write the failing tests**

Create `test/filter-codec.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { encode, decode } = require('../src/filter-codec');

test('a value survives the round trip', () => {
    const value = { 'cypress/e2e/a.cy.js': [['Root', 'A. Card structure']] };
    assert.deepEqual(decode(encode(value)), value);
});

test('the encoded text has no padding and no comma', () => {
    // Cypress splits the values on --expose at commas, and the flag is already
    // written as key=value, so a comma or an equals sign in the value can break it.
    const text = encode({ 'a/b.cy.js': [['One', 'Two'], ['One', 'Three']] });
    assert.equal(text.includes('='), false);
    assert.equal(text.includes(','), false);
    assert.equal(/^[A-Za-z0-9_-]+$/.test(text), true);
});

test('text outside plain ASCII survives', () => {
    // Suite titles in real projects contain characters such as the long dash.
    const value = { 'a.cy.js': [['Root', 'Requested by: \u2014 and \u00e9']] };
    assert.deepEqual(decode(encode(value)), value);
});

test('decode returns null for nothing, rather than throwing', () => {
    assert.equal(decode(''), null);
    assert.equal(decode(null), null);
    assert.equal(decode(undefined), null);
});

test('decode returns null for text that is not a filter, rather than throwing', () => {
    assert.equal(decode('not base64url at all !!'), null);
});

test('a value whose length is not a multiple of four decodes', () => {
    // Padding is stripped on the way out, so decode has to put it back. Each of
    // these lengths leaves a different remainder.
    for (const text of ['a', 'ab', 'abc', 'abcd']) {
        const value = { k: 'x'.repeat(text.length) };
        assert.deepEqual(decode(encode(value)), value);
    }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/filter-codec.test.js
```

Expected: FAIL, cannot find module `../src/filter-codec`.

- [ ] **Step 3: Write the implementation**

Create `src/filter-codec.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/filter-codec.test.js
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/filter-codec.js test/filter-codec.test.js
git commit -m "$(cat <<'MSG'
feat: encode the picked contexts for the command line

base64url, because Cypress splits the values on its --expose flag at commas and
writes them as key=value, and plain base64 pads with an equals sign.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: Reading the suites out of a spec file

**Files:**
- Create: `src/spec-scan.js`
- Create: `test/fixtures/simple.cy.js`
- Create: `test/fixtures/tricky.cy.js`
- Test: `test/spec-scan.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `scanSource(source: string) => { suites: Suite[], tests: number }`
  - `scanFile(absolutePath: string) => { suites: Suite[], tests: number }`
  - `Suite = { title: string|null, path: string[], depth: number, tests: number, modifier: 'only'|'skip'|null, readable: boolean }`

`depth` is 0 for the outermost suite. `tests` on a suite counts every test inside it, including those in suites nested within it. `readable` is false when the title is not a plain quoted string, for example when it is built from a variable.

- [ ] **Step 1: Write the fixtures**

Create `test/fixtures/simple.cy.js`:

```js
describe('Projects', () => {
    context('Search', () => {
        it('finds one', () => {})
        it('finds none', () => {})
    })

    context('Pagination', () => {
        it('goes forward', () => {})

        context('Multi-page navigation', () => {
            it('goes back', () => {})
        })
    })

    context.skip('Project Details', () => {
        it('shows the name', () => {})
    })

    it('loose test in the outermost suite', () => {})
})
```

Create `test/fixtures/tricky.cy.js`. Every trap in it is one the scanner has to survive, and all of them appear in real spec files:

```js
// A comment that mentions context('Not real') and it('also not real').
/*
   A block comment with describe('Still not real') inside it.
*/
const NAME = 'built from a variable'

describe('Root', { expose: { skipLogin: true } }, () => {
    // A string containing the word context('fake') must not count.
    const note = "context('fake')"

    context('Quoted "double" and \'single\'', () => {
        it('has a title with quotes', () => {})
    })

    context(`template ${NAME}`, () => {
        it('cannot have its title read', () => {})
    })

    context.only('Only this one', () => {
        it('runs', () => {})
        it.skip('does not run', () => {})
    })

    specify('specify counts as a test', () => {})
})
```

- [ ] **Step 2: Write the failing tests**

Create `test/spec-scan.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { scanFile } = require('../src/spec-scan');

const fixture = (name) => path.join(__dirname, 'fixtures', name);

test('it reads every suite with its nesting and its title path', () => {
    const { suites } = scanFile(fixture('simple.cy.js'));
    assert.deepEqual(
        suites.map((s) => [s.depth, s.title]),
        [
            [0, 'Projects'],
            [1, 'Search'],
            [1, 'Pagination'],
            [2, 'Multi-page navigation'],
            [1, 'Project Details'],
        ]
    );
    assert.deepEqual(suites[3].path, ['Projects', 'Pagination', 'Multi-page navigation']);
});

test('it counts the tests in a suite, including those nested inside it', () => {
    const { suites, tests } = scanFile(fixture('simple.cy.js'));
    const byTitle = Object.fromEntries(suites.map((s) => [s.title, s.tests]));
    assert.equal(byTitle.Search, 2);
    assert.equal(byTitle.Pagination, 2);
    assert.equal(byTitle['Multi-page navigation'], 1);
    assert.equal(byTitle['Project Details'], 1);
    assert.equal(byTitle.Projects, 6);
    assert.equal(tests, 6);
});

test('it records skip and only on the suite that carries them', () => {
    const { suites } = scanFile(fixture('simple.cy.js'));
    const details = suites.find((s) => s.title === 'Project Details');
    assert.equal(details.modifier, 'skip');
    assert.equal(suites.find((s) => s.title === 'Search').modifier, null);
});

test('it ignores suite names inside comments and strings', () => {
    const { suites } = scanFile(fixture('tricky.cy.js'));
    const titles = suites.map((s) => s.title);
    assert.equal(titles.includes('Not real'), false);
    assert.equal(titles.includes('Still not real'), false);
    assert.equal(titles.includes('fake'), false);
});

test('it reads a title containing quotes of the other kind', () => {
    const { suites } = scanFile(fixture('tricky.cy.js'));
    assert.ok(suites.some((s) => s.title === 'Quoted "double" and \'single\''));
});

test('it marks a title built from a template as unreadable', () => {
    const { suites } = scanFile(fixture('tricky.cy.js'));
    const unreadable = suites.filter((s) => s.readable === false);
    assert.equal(unreadable.length, 1);
    assert.equal(unreadable[0].title, null);
    assert.equal(unreadable[0].tests, 1);
});

test('it records only, and counts specify and it.skip as tests', () => {
    const { suites, tests } = scanFile(fixture('tricky.cy.js'));
    assert.equal(suites.find((s) => s.title === 'Only this one').modifier, 'only');
    assert.equal(suites.find((s) => s.title === 'Only this one').tests, 2);
    assert.equal(tests, 5);
});

test('a suite declared with a config object is still read', () => {
    const { suites } = scanFile(fixture('tricky.cy.js'));
    assert.equal(suites[0].title, 'Root');
    assert.equal(suites[0].depth, 0);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/spec-scan.test.js
```

Expected: FAIL, cannot find module `../src/spec-scan`.

- [ ] **Step 4: Write the implementation**

Create `src/spec-scan.js`:

```js
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
            // An unterminated string, or a template with a substitution in it. Step
            // past the opening quote and carry on rather than stopping the scan.
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
                    i = quoted ? quoted.end + 1 : k + 1;
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
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/spec-scan.test.js
```

Expected: PASS, 8 tests. If the nesting assertions fail, the likely cause is `closeFinished` running at the wrong moment. The rule it enforces is that a suite stays open while the brace depth is greater than the depth recorded when its call was found.

- [ ] **Step 6: Check the scanner against the real project it was written for**

This is the check that matters, because the fixtures were written by the same person as the scanner. `konjuur-cypress` has 19 spec files, one of them 291 tests, and its spec files quote suite names inside comments more than most.

The comparison is against a plain text search, which is the thing the scanner is meant to improve on. They are expected to agree on most files and to disagree where a suite or test name appears inside a comment or a string. Every disagreement has to be explained, in one direction or the other, before this task is done.

```bash
cd /c/Users/User/Documents/code/cypress-pick
node -e "
const { scanFile } = require('./src/spec-scan');
const { execSync } = require('child_process');
const fs = require('fs');
const dir = 'C:/Users/User/Documents/code/konjuur-cypress/cypress/e2e/konjuur/';
let total = 0;
for (const f of fs.readdirSync(dir)) {
  const r = scanFile(dir + f);
  total += r.tests;
  const count = (p) => Number(execSync('grep -oE \"' + p + '\" \"' + dir + f + '\" | wc -l').toString().trim());
  const greppedTests = count('\\\\\\\\b(it|specify)(\\\\\\\\.(only|skip))?\\\\\\\\(');
  const greppedSuites = count('\\\\\\\\b(describe|context)(\\\\\\\\.(only|skip))?\\\\\\\\(');
  const flag = (r.tests === greppedTests && r.suites.length === greppedSuites) ? '' : '   <-- explain this one';
  console.log(f.padEnd(50), 'tests', String(r.tests).padStart(4), 'vs', String(greppedTests).padStart(4),
              '  suites', String(r.suites.length).padStart(3), 'vs', String(greppedSuites).padStart(3), flag);
}
console.log('TOTAL tests', total);
"
```

Expected: **764 tests in total.** That figure was measured in the project on 2026-11-11 and is the one number to hold the scanner to.

Three differences are correct behaviour rather than defects, and are the only kinds that may be left standing:

- The text search counts a suite or test name written inside a comment or a string. The scanner does not, which is the whole reason it exists. Confirm by finding the line, for example with `grep -n "context(" <file>` and reading it.
- `create-project.cy.js` has one test generated by a loop over eight cases, so the number of tests it actually schedules is 298 against the 291 both counts report. The scanner counts what is written in the file. Do not try to make it count loops.
- A title built from a template is still counted as a suite, with its title recorded as unreadable. Both counts include it.

Any other difference is a scanner defect. Fix it and re-run.

- [ ] **Step 7: Commit**

```bash
git add src/spec-scan.js test/spec-scan.test.js test/fixtures/
git commit -m "$(cat <<'MSG'
feat: read the describe and context blocks out of a spec file

Walks the file one character at a time so a suite name written inside a comment
or a string is not counted. Real spec files are full of both. Nesting comes from
curly brace depth. Checked against all 19 specs in konjuur-cypress, 764 tests.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: Turning a selection into Cypress arguments

**Files:**
- Create: `src/build-args.js`
- Test: `test/build-args.test.js`

**Interfaces:**
- Consumes: `src/filter-codec.js` (`encode`)
- Produces:
  - `buildSelection(specs: PickedSpec[]) => { specs: string[], filter: object }`
  - `buildArgs(selection, { cypressMajor: number }) => string[]`
  - `buildEnv(selection, { cypressMajor: number }) => { CYPICK_SPEC, CYPICK_FILTER, CYPICK_FLAG }`

`PickedSpec` is `{ relative: string, checked: boolean, suites: [{ path: string[], checked: boolean, selectable: boolean }] }`.

The rule that must hold: a spec with every selectable suite ticked produces **no** filter entry, so the common case runs the same command the project already runs.

- [ ] **Step 1: Write the failing tests**

Create `test/build-args.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildSelection, buildArgs, buildEnv } = require('../src/build-args');
const { decode } = require('../src/filter-codec');

const spec = (relative, checked, suites) => ({ relative, checked, suites });
const suite = (path, checked, selectable = true) => ({ path, checked, selectable });

test('a spec with everything ticked contributes no filter', () => {
    const sel = buildSelection([
        spec('cypress/e2e/a.cy.js', true, [
            suite(['Root', 'A'], true),
            suite(['Root', 'B'], true),
        ]),
    ]);
    assert.deepEqual(sel.specs, ['cypress/e2e/a.cy.js']);
    assert.deepEqual(sel.filter, {});
});

test('a spec with no suites at all contributes no filter', () => {
    const sel = buildSelection([spec('cypress/e2e/a.cy.js', true, [])]);
    assert.deepEqual(sel.specs, ['cypress/e2e/a.cy.js']);
    assert.deepEqual(sel.filter, {});
});

test('a spec with some suites ticked contributes those paths', () => {
    const sel = buildSelection([
        spec('cypress/e2e/a.cy.js', true, [
            suite(['Root', 'A'], true),
            suite(['Root', 'B'], false),
        ]),
    ]);
    assert.deepEqual(sel.filter, { 'cypress/e2e/a.cy.js': [['Root', 'A']] });
});

test('a suite that cannot be ticked is left out of the all-ticked test', () => {
    // A skipped context can never be ticked, so a spec whose only unticked suite is
    // a skipped one still counts as ticked whole.
    const sel = buildSelection([
        spec('cypress/e2e/a.cy.js', true, [
            suite(['Root', 'A'], true),
            suite(['Root', 'Skipped'], false, false),
        ]),
    ]);
    assert.deepEqual(sel.filter, {});
});

test('an unticked spec is left out entirely', () => {
    const sel = buildSelection([
        spec('cypress/e2e/a.cy.js', true, [suite(['Root', 'A'], true)]),
        spec('cypress/e2e/b.cy.js', false, [suite(['Root', 'A'], false)]),
    ]);
    assert.deepEqual(sel.specs, ['cypress/e2e/a.cy.js']);
});

test('Cypress 16 and above gets the expose flag', () => {
    const sel = buildSelection([
        spec('a.cy.js', true, [suite(['Root', 'A'], true), suite(['Root', 'B'], false)]),
    ]);
    const args = buildArgs(sel, { cypressMajor: 16 });
    assert.deepEqual(args.slice(0, 2), ['--spec', 'a.cy.js']);
    assert.equal(args[2], '--expose');
    assert.equal(args[3].startsWith('cypressPick='), true);
    assert.deepEqual(decode(args[3].slice('cypressPick='.length)), sel.filter);
});

test('below Cypress 16 gets the env flag instead', () => {
    const sel = buildSelection([
        spec('a.cy.js', true, [suite(['Root', 'A'], true), suite(['Root', 'B'], false)]),
    ]);
    assert.equal(buildArgs(sel, { cypressMajor: 15 })[2], '--env');
});

test('no filter means no flag at all, only the spec list', () => {
    const sel = buildSelection([spec('a.cy.js', true, [suite(['Root', 'A'], true)])]);
    assert.deepEqual(buildArgs(sel, { cypressMajor: 16 }), ['--spec', 'a.cy.js']);
});

test('several specs are joined with commas', () => {
    const sel = buildSelection([
        spec('a.cy.js', true, []),
        spec('b.cy.js', true, []),
    ]);
    assert.deepEqual(buildArgs(sel, { cypressMajor: 16 }), ['--spec', 'a.cy.js,b.cy.js']);
});

test('the environment variables carry the same values', () => {
    const sel = buildSelection([
        spec('a.cy.js', true, [suite(['Root', 'A'], true), suite(['Root', 'B'], false)]),
    ]);
    const env = buildEnv(sel, { cypressMajor: 16 });
    assert.equal(env.CYPICK_SPEC, 'a.cy.js');
    assert.equal(env.CYPICK_FLAG, '--expose');
    assert.deepEqual(decode(env.CYPICK_FILTER), sel.filter);
});

test('the environment variables omit the filter when there is none', () => {
    const env = buildEnv(buildSelection([spec('a.cy.js', true, [])]), { cypressMajor: 16 });
    assert.equal(env.CYPICK_SPEC, 'a.cy.js');
    assert.equal('CYPICK_FILTER' in env, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/build-args.test.js
```

Expected: FAIL, cannot find module `../src/build-args`.

- [ ] **Step 3: Write the implementation**

Create `src/build-args.js`:

```js
'use strict';

const { encode } = require('./filter-codec');

const FILTER_KEY = 'cypressPick';

// A spec whose contexts are all ticked produces no filter entry. That is what keeps
// the common case, ticking a spec and never opening it, producing exactly the
// command the project already runs today, so it cannot behave differently from it.
// A context that cannot be ticked, which today means a skipped one, is left out of
// that judgement.
function buildSelection(specs) {
    const picked = specs.filter((s) => s.checked);
    const filter = {};

    for (const s of picked) {
        const selectable = s.suites.filter((x) => x.selectable);
        const ticked = selectable.filter((x) => x.checked);
        if (selectable.length === 0 || ticked.length === selectable.length) continue;
        filter[s.relative] = ticked.map((x) => x.path);
    }

    return { specs: picked.map((s) => s.relative), filter };
}

// Cypress 16 removed Cypress.env() and added the --expose flag in its place, so the
// flag depends on the host project's version.
function flagFor(cypressMajor) {
    return cypressMajor >= 16 ? '--expose' : '--env';
}

function buildArgs(selection, { cypressMajor }) {
    const args = ['--spec', selection.specs.join(',')];
    if (Object.keys(selection.filter).length === 0) return args;
    args.push(flagFor(cypressMajor), FILTER_KEY + '=' + encode(selection.filter));
    return args;
}

// Used when the picker runs one of the host project's own scripts. The script's own
// runner reads these and adds the flags itself, because a script that chains several
// commands has no single place to add an argument to.
function buildEnv(selection, { cypressMajor }) {
    const env = {
        CYPICK_SPEC: selection.specs.join(','),
        CYPICK_FLAG: flagFor(cypressMajor),
    };
    if (Object.keys(selection.filter).length > 0) {
        env.CYPICK_FILTER = encode(selection.filter);
    }
    return env;
}

module.exports = { buildSelection, buildArgs, buildEnv, FILTER_KEY };
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/build-args.test.js
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/build-args.js test/build-args.test.js
git commit -m "$(cat <<'MSG'
feat: turn a selection into Cypress arguments

A spec with every context ticked produces no filter at all, so the common case
runs exactly the command the project already runs. Cypress 16 and above takes
the expose flag, below that takes the env flag.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: The list's state and key handling

The list is drawn in Task 7. This task is everything about it that can be tested without a terminal.

**Files:**
- Create: `src/list-state.js`
- Test: `test/list-state.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `createState(scannedSpecs) => State` where `scannedSpecs` is `[{ relative, tests, suites }]` from Task 4, with `suites` already filtered to `depth >= 1`
  - `visibleRows(state) => Row[]`, `Row = { kind: 'spec'|'suite', specIndex, suiteIndex, depth, label, mark, selectable, note }`
  - `reduce(state, keyName) => State` where `keyName` is one of `up`, `down`, `toggle`, `open`, `close`, `all`, `none`
  - `toPickedSpecs(state) => PickedSpec[]`, the shape Task 5's `buildSelection` takes
  - `warnings(state) => string[]`

`mark` is `'x'`, `'~'` or `' '`. A spec is `'~'` when some but not all of its selectable suites are ticked.

- [ ] **Step 1: Write the failing tests**

Create `test/list-state.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createState, visibleRows, reduce, toPickedSpecs, warnings } = require('../src/list-state');

const SCANNED = [
    {
        relative: 'cypress/e2e/a.cy.js',
        tests: 6,
        suites: [
            { title: 'A one', path: ['Root', 'A one'], depth: 1, tests: 2, modifier: null, readable: true },
            { title: 'A two', path: ['Root', 'A two'], depth: 1, tests: 3, modifier: null, readable: true },
            { title: 'A skipped', path: ['Root', 'A skipped'], depth: 1, tests: 1, modifier: 'skip', readable: true },
        ],
    },
    {
        relative: 'cypress/e2e/b.cy.js',
        tests: 4,
        suites: [
            { title: 'B one', path: ['Root', 'B one'], depth: 1, tests: 4, modifier: 'only', readable: true },
        ],
    },
];

const marks = (state) => visibleRows(state).map((r) => r.kind + ':' + r.mark + ':' + r.label);

test('it starts with nothing ticked, nothing open, and the cursor at the top', () => {
    const state = createState(SCANNED);
    assert.equal(state.cursor, 0);
    assert.deepEqual(visibleRows(state).map((r) => r.kind), ['spec', 'spec']);
    assert.equal(visibleRows(state)[0].mark, ' ');
});

test('opening a spec shows its contexts, closing hides them again', () => {
    let state = reduce(createState(SCANNED), 'open');
    assert.deepEqual(visibleRows(state).map((r) => r.kind), ['spec', 'suite', 'suite', 'suite', 'spec']);
    state = reduce(state, 'close');
    assert.deepEqual(visibleRows(state).map((r) => r.kind), ['spec', 'spec']);
});

test('ticking a spec ticks all of its selectable contexts but not a skipped one', () => {
    let state = reduce(createState(SCANNED), 'toggle');
    state = reduce(state, 'open');
    assert.deepEqual(marks(state), [
        'spec:x:cypress/e2e/a.cy.js',
        'suite:x:A one',
        'suite:x:A two',
        'suite: :A skipped',
        'spec: :cypress/e2e/b.cy.js',
    ]);
});

test('unticking one context makes the spec partial', () => {
    let state = reduce(createState(SCANNED), 'toggle');
    state = reduce(state, 'open');
    state = reduce(state, 'down');
    state = reduce(state, 'toggle');
    assert.equal(visibleRows(state)[0].mark, '~');
});

test('unticking every context unticks the spec', () => {
    let state = reduce(createState(SCANNED), 'toggle');
    state = reduce(state, 'open');
    state = reduce(reduce(state, 'down'), 'toggle');
    state = reduce(reduce(state, 'down'), 'toggle');
    assert.equal(visibleRows(state)[0].mark, ' ');
    assert.deepEqual(toPickedSpecs(state).filter((s) => s.checked), []);
});

test('ticking a context ticks its spec', () => {
    let state = reduce(createState(SCANNED), 'open');
    state = reduce(reduce(state, 'down'), 'toggle');
    assert.equal(visibleRows(state)[0].mark, '~');
});

test('a skipped context cannot be ticked', () => {
    let state = reduce(createState(SCANNED), 'open');
    state = reduce(reduce(reduce(state, 'down'), 'down'), 'down');
    const before = visibleRows(state)[3].mark;
    state = reduce(state, 'toggle');
    assert.equal(visibleRows(state)[3].mark, before);
    assert.equal(visibleRows(state)[3].note, 'skipped');
});

test('the cursor stops at both ends rather than wrapping', () => {
    let state = createState(SCANNED);
    state = reduce(state, 'up');
    assert.equal(state.cursor, 0);
    state = reduce(reduce(reduce(state, 'down'), 'down'), 'down');
    assert.equal(state.cursor, 1);
});

test('all ticks every spec and none unticks them', () => {
    let state = reduce(createState(SCANNED), 'all');
    assert.deepEqual(visibleRows(state).map((r) => r.mark), ['x', 'x']);
    state = reduce(state, 'none');
    assert.deepEqual(visibleRows(state).map((r) => r.mark), [' ', ' ']);
});

test('a ticked spec carrying only is warned about, an unticked one is not', () => {
    let state = createState(SCANNED);
    assert.deepEqual(warnings(state), []);
    state = reduce(state, 'all');
    assert.equal(warnings(state).length, 1);
    assert.match(warnings(state)[0], /b\.cy\.js/);
    assert.match(warnings(state)[0], /only/);
});

test('toPickedSpecs gives build-args what it expects', () => {
    let state = reduce(createState(SCANNED), 'toggle');
    const picked = toPickedSpecs(state);
    assert.equal(picked[0].relative, 'cypress/e2e/a.cy.js');
    assert.equal(picked[0].checked, true);
    assert.deepEqual(picked[0].suites[0], { path: ['Root', 'A one'], checked: true, selectable: true });
    assert.equal(picked[0].suites[2].selectable, false);
});

test('a context whose title could not be read cannot be ticked', () => {
    const scanned = [{
        relative: 'c.cy.js',
        tests: 1,
        suites: [{ title: null, path: ['Root', ''], depth: 1, tests: 1, modifier: null, readable: false }],
    }];
    let state = reduce(createState(scanned), 'open');
    const row = visibleRows(state)[1];
    assert.equal(row.selectable, false);
    assert.equal(row.note, 'title cannot be read');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/list-state.test.js
```

Expected: FAIL, cannot find module `../src/list-state`.

- [ ] **Step 3: Write the implementation**

Create `src/list-state.js`:

```js
'use strict';

// Everything about the list that does not need a terminal. The drawing lives in
// src/checkbox-list.js, which calls into here for every key. Keeping the two apart
// is what makes the behaviour testable.

// A context that cannot be ticked is one the picker could not honour: a skipped one
// will not run whatever is asked, and one whose title could not be read cannot be
// named on the command line.
function noteFor(suite) {
    if (suite.modifier === 'skip') return 'skipped';
    if (!suite.readable) return 'title cannot be read';
    if (suite.modifier === 'only') return 'only';
    return null;
}

function selectableSuite(suite) {
    return suite.modifier !== 'skip' && suite.readable;
}

function createState(scannedSpecs) {
    return {
        cursor: 0,
        specs: scannedSpecs.map((s) => ({
            relative: s.relative,
            tests: s.tests,
            open: false,
            checked: false,
            suites: s.suites.map((x) => ({
                title: x.title,
                path: x.path,
                depth: x.depth,
                tests: x.tests,
                modifier: x.modifier,
                readable: x.readable,
                selectable: selectableSuite(x),
                note: noteFor(x),
                checked: false,
            })),
        })),
    };
}

function clone(state) {
    return {
        cursor: state.cursor,
        specs: state.specs.map((s) => ({ ...s, suites: s.suites.map((x) => ({ ...x })) })),
    };
}

function markFor(spec) {
    const selectable = spec.suites.filter((x) => x.selectable);
    if (!spec.checked) return ' ';
    if (selectable.length === 0) return 'x';
    const ticked = selectable.filter((x) => x.checked).length;
    if (ticked === selectable.length) return 'x';
    return '~';
}

function visibleRows(state) {
    const rows = [];
    state.specs.forEach((spec, specIndex) => {
        rows.push({
            kind: 'spec',
            specIndex,
            suiteIndex: -1,
            depth: 0,
            label: spec.relative,
            mark: markFor(spec),
            selectable: true,
            note: spec.suites.some((x) => x.modifier === 'only') ? 'only' : null,
            tests: spec.tests,
            open: spec.open,
        });
        if (!spec.open) return;
        spec.suites.forEach((suite, suiteIndex) => {
            rows.push({
                kind: 'suite',
                specIndex,
                suiteIndex,
                depth: suite.depth,
                label: suite.title === null ? '(title built at run time)' : suite.title,
                mark: suite.checked ? 'x' : ' ',
                selectable: suite.selectable,
                note: suite.note,
                tests: suite.tests,
                open: false,
            });
        });
    });
    return rows;
}

// Ticking a context implies its spec is in the run. Unticking the last one takes the
// spec out, which is what makes "untick everything" mean "do not run this spec".
function syncSpecFromSuites(spec) {
    const selectable = spec.suites.filter((x) => x.selectable);
    if (selectable.length === 0) return;
    spec.checked = selectable.some((x) => x.checked);
}

function setSpec(spec, checked) {
    spec.checked = checked;
    for (const suite of spec.suites) {
        if (suite.selectable) suite.checked = checked;
    }
}

function reduce(state, keyName) {
    const next = clone(state);
    const rows = visibleRows(next);
    const row = rows[next.cursor];

    switch (keyName) {
        case 'up':
            next.cursor = Math.max(0, next.cursor - 1);
            return next;
        case 'down':
            next.cursor = Math.min(rows.length - 1, next.cursor + 1);
            return next;
        case 'open':
            if (row && row.kind === 'spec') next.specs[row.specIndex].open = true;
            return next;
        case 'close':
            if (!row) return next;
            if (row.kind === 'suite') {
                next.specs[row.specIndex].open = false;
                next.cursor = visibleRows(next).findIndex((r) => r.kind === 'spec' && r.specIndex === row.specIndex);
                return next;
            }
            next.specs[row.specIndex].open = false;
            return next;
        case 'toggle': {
            if (!row) return next;
            const spec = next.specs[row.specIndex];
            if (row.kind === 'spec') {
                setSpec(spec, !spec.checked);
                return next;
            }
            const suite = spec.suites[row.suiteIndex];
            if (!suite.selectable) return next;
            suite.checked = !suite.checked;
            syncSpecFromSuites(spec);
            return next;
        }
        case 'all':
            for (const spec of next.specs) setSpec(spec, true);
            return next;
        case 'none':
            for (const spec of next.specs) setSpec(spec, false);
            return next;
        default:
            return next;
    }
}

function toPickedSpecs(state) {
    return state.specs.map((spec) => ({
        relative: spec.relative,
        checked: spec.checked,
        suites: spec.suites.map((x) => ({ path: x.path, checked: x.checked, selectable: x.selectable })),
    }));
}

// Mocha's only beats anything this package does, so the honest thing is to say what
// will actually run rather than to pretend the picked contexts decide it.
function warnings(state) {
    const lines = [];
    for (const spec of state.specs) {
        if (!spec.checked) continue;
        const only = spec.suites.filter((x) => x.modifier === 'only');
        if (only.length === 0) continue;
        const willRun = only.reduce((sum, x) => sum + x.tests, 0);
        const names = only.map((x) => "'" + (x.title === null ? '?' : x.title) + "'").join(', ');
        lines.push(
            spec.relative + ' carries only on ' + names + ', so ' + willRun + ' of its ' +
            spec.tests + ' tests will run whatever is ticked here.'
        );
    }
    return lines;
}

module.exports = { createState, visibleRows, reduce, toPickedSpecs, warnings };
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/list-state.test.js
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/list-state.js test/list-state.test.js
git commit -m "$(cat <<'MSG'
feat: the list's state and key handling

Ticking a spec ticks its contexts, unticking the last context unticks the spec,
and a skipped or unreadable context cannot be ticked at all. Kept apart from the
drawing so the behaviour can be tested without a terminal.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: Drawing the list

**Files:**
- Create: `src/checkbox-list.js`
- Create: `test/manual/demo-list.js`

**Interfaces:**
- Consumes: `src/list-state.js`
- Produces:
  - `renderLines(state, { title, width }) => string[]` a plain function, no terminal involved
  - `promptList(state, { title, stdin, stdout }) => Promise<State|null>` resolves to the final state, or null when the user quit

- [ ] **Step 1: Write the rendering, which is a plain function**

Create `src/checkbox-list.js`:

```js
'use strict';

const { visibleRows, reduce } = require('./list-state');

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

const QUIT_KEYS = ['q', '\u0003', '\u001b'];
const ACCEPT_KEYS = ['\r', '\n'];

function pad(text, width) {
    return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function renderLines(state, { title, width = 78 } = {}) {
    const rows = visibleRows(state);
    const lines = ['', '  ' + title, ''];

    rows.forEach((row, index) => {
        const cursor = index === state.cursor ? '>' : ' ';
        const indent = '  '.repeat(row.depth);
        const box = row.selectable ? '[' + row.mark + ']' : ' - ';
        const left = cursor + ' ' + box + ' ' + indent + row.label;
        const right = row.kind === 'spec' ? String(row.tests) : '';
        const note = row.note ? '  ' + row.note : '';
        lines.push(pad(left, width - 6) + pad(right, 5) + note);
    });

    lines.push('');
    lines.push('  [x] whole spec   [~] some contexts   [ ] not running');
    lines.push('  up/down move   space tick   right open   left close   a all   n none');
    lines.push('  enter run   q quit');
    return lines;
}

// Reads keys until the user accepts or quits. Everything it does to the terminal is
// undone before it returns, including on Ctrl+C, because a terminal left in raw mode
// with the cursor hidden is unusable afterwards.
function promptList(state, { title, stdin = process.stdin, stdout = process.stdout } = {}) {
    return new Promise((resolve) => {
        let current = state;
        let drawnLines = 0;

        const draw = () => {
            if (drawnLines > 0) stdout.write('\u001b[' + drawnLines + 'A\u001b[0J');
            const lines = renderLines(current, { title });
            stdout.write(lines.join('\n') + '\n');
            drawnLines = lines.length;
        };

        const restore = () => {
            stdin.removeListener('data', onData);
            if (stdin.isTTY) stdin.setRawMode(false);
            stdin.pause();
            stdout.write('\u001b[?25h');
        };

        const onData = (chunk) => {
            const key = chunk.toString();

            if (QUIT_KEYS.includes(key)) {
                restore();
                resolve(null);
                return;
            }
            if (ACCEPT_KEYS.includes(key)) {
                restore();
                resolve(current);
                return;
            }
            const action = KEYS[key];
            if (!action) return;
            current = reduce(current, action);
            draw();
        };

        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
        stdout.write('\u001b[?25l');
        draw();
    });
}

module.exports = { renderLines, promptList, KEYS, QUIT_KEYS, ACCEPT_KEYS };
```

- [ ] **Step 2: Write the manual demo**

`promptList` touches the terminal, so it is checked by hand rather than by a test. Create `test/manual/demo-list.js`:

```js
'use strict';

// Run this by hand to check the list draws and responds. It runs against the real
// spec files of whatever project path is given, and it never starts Cypress.
//
//   node test/manual/demo-list.js C:/Users/User/Documents/code/konjuur-cypress

const path = require('node:path');
const fs = require('node:fs');
const { scanFile } = require('../../src/spec-scan');
const { createState, toPickedSpecs, warnings } = require('../../src/list-state');
const { promptList } = require('../../src/checkbox-list');
const { buildSelection, buildArgs } = require('../../src/build-args');

const project = process.argv[2];
const dir = path.join(project, 'cypress', 'e2e', 'konjuur');

const scanned = fs.readdirSync(dir).filter((f) => f.endsWith('.cy.js')).map((f) => {
    const result = scanFile(path.join(dir, f));
    return {
        relative: 'cypress/e2e/konjuur/' + f,
        tests: result.tests,
        suites: result.suites.filter((s) => s.depth >= 1),
    };
});

promptList(createState(scanned), { title: 'demo, nothing will run' }).then((state) => {
    if (!state) {
        console.log('quit');
        return;
    }
    console.log('');
    for (const line of warnings(state)) console.log('  ' + line);
    console.log('  args:', buildArgs(buildSelection(toPickedSpecs(state)), { cypressMajor: 16 }).join(' '));
});
```

- [ ] **Step 3: Run the demo and check it by hand**

```bash
cd /c/Users/User/Documents/code/cypress-pick
node test/manual/demo-list.js C:/Users/User/Documents/code/konjuur-cypress
```

Check each of these, which are the things that break in a hand written list:

- [ ] Arrow keys move the cursor, and it stops at the top and the bottom rather than wrapping
- [ ] Space ticks and unticks
- [ ] Right opens a spec and shows its contexts indented, left closes it again
- [ ] Ticking a spec then unticking one context shows `[~]`
- [ ] A skipped context shows ` - ` and the word `skipped`, and space does nothing on it
- [ ] `a` ticks everything, `n` unticks everything
- [ ] The list redraws in place rather than scrolling a new copy each time
- [ ] `q` and Ctrl+C both exit, and the terminal still echoes typing afterwards
- [ ] Enter prints the arguments, and ticking `confirmed-bugs.cy.js` prints the warning about `only`

If the redraw leaves copies behind, the cause is `drawnLines` not matching what was written. The screen is rewound by exactly the number of lines drawn last time.

- [ ] **Step 4: Commit**

```bash
git add src/checkbox-list.js test/manual/demo-list.js
git commit -m "$(cat <<'MSG'
feat: draw the list and read keys

Redraws in place. Restores the cursor and the terminal mode on every exit path,
including Ctrl+C, because a terminal left in raw mode is unusable afterwards.
Checked by hand against the 19 specs in konjuur-cypress.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: Reading the host project

**Files:**
- Create: `src/host-config.js`
- Create: `src/npm-scripts.js`
- Test: `test/host-config.test.js`
- Test: `test/npm-scripts.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `readHost(cwd) => { specPattern: string[], excludeSpecPattern: string[], supportFile: string|null, cypressMajor: number|null, configRead: boolean }`
  - `findSpecs(cwd, host) => string[]` relative paths with forward slashes, sorted
  - `isSupportInstalled(cwd, host) => boolean`
  - `runnableScripts(packageJson) => [{ name, command }]`

- [ ] **Step 1: Write the failing tests for the scripts reader**

Create `test/npm-scripts.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { runnableScripts } = require('../src/npm-scripts');

// Taken from konjuur-cypress, because it is the shape this has to handle: a chain
// of scripts where the one that starts Cypress is three steps in.
const KONJUUR = {
    scripts: {
        test: 'npx cypress open',
        headless: 'node scripts/run-cypress.js',
        'headless:evidence': 'cross-env ALWAYS_VIDEO=true node scripts/run-cypress.js',
        'report:clean': 'rimraf cypress/results cypress/reports/.work',
        'report:merge': 'mochawesome-merge cypress/results/*.json -o cypress/results/mochawesome.json',
        'report:pdf': 'node scripts/generate-report.js',
        report: 'npm run report:merge && npm run report:pdf',
        'test:report': 'npm run report:clean && npm run headless && npm run report',
        'test:evidence': 'npm run report:clean && npm run headless:evidence && npm run report',
    },
};

test('it leaves out a script that opens the Cypress window', () => {
    const names = runnableScripts(KONJUUR).map((s) => s.name);
    assert.equal(names.includes('test'), false);
});

test('it leaves out a script that opens the window further down a chain', () => {
    const names = runnableScripts({ scripts: { open: 'npx cypress open', both: 'npm run open && npm run x', x: 'echo' } }).map((s) => s.name);
    assert.equal(names.includes('both'), false);
});

test('it keeps the headless and report scripts', () => {
    const names = runnableScripts(KONJUUR).map((s) => s.name);
    for (const expected of ['headless', 'headless:evidence', 'test:report', 'test:evidence']) {
        assert.equal(names.includes(expected), true, expected + ' should be offered');
    }
});

test('it returns an empty list when there are no scripts', () => {
    assert.deepEqual(runnableScripts({}), []);
    assert.deepEqual(runnableScripts({ scripts: {} }), []);
});

test('a chain that refers to itself does not hang', () => {
    const names = runnableScripts({ scripts: { a: 'npm run b', b: 'npm run a' } }).map((s) => s.name);
    assert.deepEqual(names.sort(), ['a', 'b']);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/npm-scripts.test.js
```

Expected: FAIL, cannot find module `../src/npm-scripts`.

- [ ] **Step 3: Write the scripts reader**

Create `src/npm-scripts.js`:

```js
'use strict';

// Which of the host project's scripts the picker will offer to run.
//
// Everything is offered except a script that opens the Cypress window, directly or
// through another script it calls. The window is a different way of working and the
// picked specs would not reach it.

function commandsFor(packageJson) {
    return (packageJson && packageJson.scripts) || {};
}

function opensTheWindow(name, scripts, seen) {
    if (seen.has(name)) return false;
    seen.add(name);

    const command = scripts[name];
    if (!command) return false;
    if (/cypress\s+open/.test(command)) return true;

    const called = command.match(/npm\s+run\s+([\w:.-]+)/g) || [];
    return called.some((piece) => opensTheWindow(piece.replace(/npm\s+run\s+/, ''), scripts, seen));
}

function runnableScripts(packageJson) {
    const scripts = commandsFor(packageJson);
    return Object.keys(scripts)
        .filter((name) => !opensTheWindow(name, scripts, new Set()))
        .map((name) => ({ name, command: scripts[name] }));
}

module.exports = { runnableScripts };
```

- [ ] **Step 4: Run them to verify they pass**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/npm-scripts.test.js
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing tests for the host reader**

Create `test/host-config.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readHost, findSpecs, isSupportInstalled } = require('../src/host-config');

function makeProject(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cypick-'));
    for (const [name, content] of Object.entries(files)) {
        const full = path.join(dir, name);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
    }
    return dir;
}

test('it reads specPattern out of a CommonJS config', () => {
    const dir = makeProject({
        'cypress.config.js': "module.exports = { e2e: { specPattern: 'tests/**/*.spec.js' } }",
    });
    const host = readHost(dir);
    assert.deepEqual(host.specPattern, ['tests/**/*.spec.js']);
    assert.equal(host.configRead, true);
});

test('it falls back to the Cypress defaults when there is no config it can read', () => {
    const dir = makeProject({ 'cypress.config.ts': 'export default {}' });
    const host = readHost(dir);
    assert.deepEqual(host.specPattern, ['cypress/e2e/**/*.cy.{js,jsx,ts,tsx}']);
    assert.equal(host.supportFile, 'cypress/support/e2e.js');
    assert.equal(host.configRead, false);
});

test('it finds spec files and returns them with forward slashes', () => {
    const dir = makeProject({
        'cypress.config.js': 'module.exports = { e2e: {} }',
        'cypress/e2e/b.cy.js': 'describe("b", () => {})',
        'cypress/e2e/nested/a.cy.js': 'describe("a", () => {})',
        'cypress/e2e/notaspec.js': '',
    });
    assert.deepEqual(findSpecs(dir, readHost(dir)), [
        'cypress/e2e/b.cy.js',
        'cypress/e2e/nested/a.cy.js',
    ]);
});

test('it honours excludeSpecPattern', () => {
    const dir = makeProject({
        'cypress.config.js': "module.exports = { e2e: { excludeSpecPattern: '**/skip-me.cy.js' } }",
        'cypress/e2e/a.cy.js': '',
        'cypress/e2e/skip-me.cy.js': '',
    });
    assert.deepEqual(findSpecs(dir, readHost(dir)), ['cypress/e2e/a.cy.js']);
});

test('it reports whether the support file imports this package', () => {
    const without = makeProject({
        'cypress.config.js': 'module.exports = { e2e: {} }',
        'cypress/support/e2e.js': "import './commands'",
    });
    assert.equal(isSupportInstalled(without, readHost(without)), false);

    const with_ = makeProject({
        'cypress.config.js': 'module.exports = { e2e: {} }',
        'cypress/support/e2e.js': "import './commands'\nimport 'cypress-pick/support'",
    });
    assert.equal(isSupportInstalled(with_, readHost(with_)), true);
});

test('it reports the host Cypress major version, or null when there is none', () => {
    const dir = makeProject({
        'cypress.config.js': 'module.exports = { e2e: {} }',
        'node_modules/cypress/package.json': '{"name":"cypress","version":"16.1.0"}',
    });
    assert.equal(readHost(dir).cypressMajor, 16);
    assert.equal(readHost(makeProject({})).cypressMajor, null);
});
```

- [ ] **Step 6: Run them to verify they fail**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/host-config.test.js
```

Expected: FAIL, cannot find module `../src/host-config`.

- [ ] **Step 7: Write the host reader**

Create `src/host-config.js`:

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// What the picker needs to know about the project it was run inside.
//
// The Cypress config is loaded with require, which works for a CommonJS config and
// not for a TypeScript or module one. When it cannot be loaded the Cypress defaults
// are used and the caller is told, so it can say so rather than appear to have found
// nothing.

const DEFAULT_SPEC_PATTERN = 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}';
const DEFAULT_SUPPORT_FILE = 'cypress/support/e2e.js';
const CONFIG_NAMES = ['cypress.config.js', 'cypress.config.cjs', 'cypress.config.mjs', 'cypress.config.ts'];
const SUPPORT_CANDIDATES = [
    'cypress/support/e2e.js',
    'cypress/support/e2e.ts',
    'cypress/support/e2e.jsx',
    'cypress/support/e2e.tsx',
];

function asList(value, fallback) {
    if (!value) return [fallback];
    return Array.isArray(value) ? value : [value];
}

function loadConfig(cwd) {
    for (const name of CONFIG_NAMES) {
        const full = path.join(cwd, name);
        if (!fs.existsSync(full)) continue;
        try {
            // Loading the config runs the file. setupNodeEvents is not called, so
            // nothing starts a browser or a server, but a config that does work at
            // the top level will do it here too.
            const loaded = require(full);
            return loaded && loaded.default ? loaded.default : loaded;
        } catch (err) {
            return null;
        }
    }
    return null;
}

function findSupportFile(cwd, fromConfig) {
    if (fromConfig === false) return null;
    if (typeof fromConfig === 'string') return fromConfig.replace(/\\/g, '/');
    for (const candidate of SUPPORT_CANDIDATES) {
        if (fs.existsSync(path.join(cwd, candidate))) return candidate;
    }
    return DEFAULT_SUPPORT_FILE;
}

function readCypressMajor(cwd) {
    const full = path.join(cwd, 'node_modules', 'cypress', 'package.json');
    try {
        return parseInt(JSON.parse(fs.readFileSync(full, 'utf8')).version.split('.')[0], 10);
    } catch (err) {
        return null;
    }
}

function readHost(cwd) {
    const config = loadConfig(cwd);
    const e2e = (config && config.e2e) || {};
    return {
        specPattern: asList(e2e.specPattern, DEFAULT_SPEC_PATTERN),
        excludeSpecPattern: e2e.excludeSpecPattern ? asList(e2e.excludeSpecPattern, null) : [],
        supportFile: findSupportFile(cwd, e2e.supportFile),
        cypressMajor: readCypressMajor(cwd),
        configRead: config !== null,
    };
}

// Node 18 has no glob of its own, and the package takes no dependencies, so the
// pattern is turned into a regular expression. Only the parts of glob syntax that
// Cypress's own patterns use are handled: **, *, ? and {a,b}.
function globToRegExp(pattern) {
    let out = '';
    for (let i = 0; i < pattern.length; i += 1) {
        const c = pattern[i];
        if (c === '*' && pattern[i + 1] === '*') {
            out += '.*';
            i += pattern[i + 2] === '/' ? 2 : 1;
            continue;
        }
        if (c === '*') { out += '[^/]*'; continue; }
        if (c === '?') { out += '[^/]'; continue; }
        if (c === '{') {
            const close = pattern.indexOf('}', i);
            out += '(' + pattern.slice(i + 1, close).split(',').map((p) => p.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')';
            i = close;
            continue;
        }
        out += /[.+^$()|[\]\\]/.test(c) ? '\\' + c : c;
    }
    return new RegExp('^' + out + '$');
}

function walk(dir, base, found) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        const relative = path.relative(base, full).replace(/\\/g, '/');
        if (entry.isDirectory()) walk(full, base, found);
        else found.push(relative);
    }
    return found;
}

function findSpecs(cwd, host) {
    const include = host.specPattern.map(globToRegExp);
    const exclude = host.excludeSpecPattern.map(globToRegExp);
    return walk(cwd, cwd, [])
        .filter((f) => include.some((re) => re.test(f)))
        .filter((f) => !exclude.some((re) => re.test(f)))
        .sort();
}

function isSupportInstalled(cwd, host) {
    if (!host.supportFile) return false;
    try {
        return fs.readFileSync(path.join(cwd, host.supportFile), 'utf8').includes('cypress-pick/support');
    } catch (err) {
        return false;
    }
}

module.exports = { readHost, findSpecs, isSupportInstalled, globToRegExp, DEFAULT_SPEC_PATTERN };
```

- [ ] **Step 8: Run them to verify they pass**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/
```

Expected: PASS, every file.

- [ ] **Step 9: Check the spec finder against the real project**

```bash
cd /c/Users/User/Documents/code/cypress-pick
node -e "
const { readHost, findSpecs, isSupportInstalled } = require('./src/host-config');
const cwd = 'C:/Users/User/Documents/code/konjuur-cypress';
const host = readHost(cwd);
console.log(host);
console.log(findSpecs(cwd, host));
console.log('support installed:', isSupportInstalled(cwd, host));
"
```

Expected: `configRead: true`, `cypressMajor: 16`, the default spec pattern, `supportFile: 'cypress/support/e2e.js'`, 19 spec files all starting `cypress/e2e/konjuur/`, and `support installed: false`, which is correct because Task 11 has not run yet.

- [ ] **Step 10: Commit**

```bash
git add src/host-config.js src/npm-scripts.js test/host-config.test.js test/npm-scripts.test.js
git commit -m "$(cat <<'MSG'
feat: read the host project's config, specs and scripts

Loads the Cypress config when it is CommonJS and falls back to the documented
defaults when it is not, saying which it did. Glob matching is written out rather
than taken from a package, because the package has no dependencies.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: The browser side filter

**Files:**
- Create: `support/index.js`
- Test: `test/support-wrap.test.js`

**Interfaces:**
- Consumes: `src/match.js`, `src/filter-codec.js`
- Produces:
  - `support/index.js` default behaviour: wraps the Mocha globals when a filter is present
  - `installFilter({ globals, selected }) => void` exported for testing, so the wrapping can be checked in Node with a stand-in for Mocha

- [ ] **Step 1: Write the failing test**

Create `test/support-wrap.test.js`. It builds a stand-in for Mocha that records what gets registered, so the wrapping can be checked without a browser:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { installFilter } = require('../support/index.js');

// A stand-in for Mocha. Registering a suite runs its callback straight away, which
// is what Mocha does, and is what lets the wrapper track which suite it is inside.
function fakeMocha() {
    const registered = { suites: [], tests: [] };
    const globals = {};

    const suite = (title, ...rest) => {
        registered.suites.push(title);
        const fn = rest[rest.length - 1];
        if (typeof fn === 'function') fn();
    };
    const testFn = (title) => { registered.tests.push(title); };

    globals.describe = suite;
    globals.describe.only = suite;
    globals.describe.skip = () => {};
    globals.context = suite;
    globals.context.only = suite;
    globals.context.skip = () => {};
    globals.it = testFn;
    globals.it.only = testFn;
    globals.it.skip = () => {};
    globals.specify = testFn;

    return { registered, globals };
}

function runSpec(globals) {
    const { describe, context, it } = globals;
    describe('Root', () => {
        it('loose test', () => {});
        context('A', () => {
            it('a one', () => {});
            context('A nested', () => {
                it('a nested one', () => {});
            });
        });
        context('B', () => {
            it('b one', () => {});
        });
    });
}

test('with no filter everything is registered', () => {
    const { registered, globals } = fakeMocha();
    installFilter({ globals, selected: [] });
    runSpec(globals);
    assert.deepEqual(registered.suites, ['Root', 'A', 'A nested', 'B']);
    assert.deepEqual(registered.tests, ['loose test', 'a one', 'a nested one', 'b one']);
});

test('one ticked context registers that context, its parent and its children only', () => {
    const { registered, globals } = fakeMocha();
    installFilter({ globals, selected: [['Root', 'A']] });
    runSpec(globals);
    assert.deepEqual(registered.suites, ['Root', 'A', 'A nested']);
    assert.deepEqual(registered.tests, ['a one', 'a nested one']);
});

test('a loose test in the outermost suite is left out of a narrowed run', () => {
    const { registered, globals } = fakeMocha();
    installFilter({ globals, selected: [['Root', 'B']] });
    runSpec(globals);
    assert.equal(registered.tests.includes('loose test'), false);
    assert.deepEqual(registered.tests, ['b one']);
});

test('only and skip are left exactly as they were', () => {
    // Mocha's only beats anything this package does, and the picker warns about that
    // rather than trying to defeat it. So the only and skip forms are not wrapped.
    const { globals } = fakeMocha();
    const beforeOnly = globals.describe.only;
    const beforeSkip = globals.describe.skip;
    installFilter({ globals, selected: [['Root', 'A']] });
    assert.equal(globals.describe.only, beforeOnly);
    assert.equal(globals.describe.skip, beforeSkip);
});

test('specify is filtered the same way as it', () => {
    const { registered, globals } = fakeMocha();
    installFilter({ globals, selected: [['Root', 'A']] });
    globals.describe('Root', () => {
        globals.context('B', () => { globals.specify('b spec', () => {}); });
        globals.context('A', () => { globals.specify('a spec', () => {}); });
    });
    assert.deepEqual(registered.tests, ['a spec']);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/support-wrap.test.js
```

Expected: FAIL, cannot find module `../support/index.js`.

- [ ] **Step 3: Write the implementation**

Create `support/index.js`:

```js
'use strict';

// The browser half of cypress-pick. A host project imports this once, in its Cypress
// support file:
//
//   import 'cypress-pick/support'
//
// With no filter present it changes nothing, so every existing way of running the
// project behaves as it did. With one, the contexts that were not ticked are never
// registered at all, which means they produce no test and no pending entry in a
// report.

const { shouldRegisterSuite, shouldRegisterTest } = require('../src/match');
const { decode } = require('../src/filter-codec');
const { FILTER_KEY } = require('../src/build-args');

// Cypress 16 reads this with Cypress.expose. Earlier versions have no expose and
// read it with Cypress.env instead.
function readFilterText(cy) {
    try {
        if (cy && typeof cy.expose === 'function') {
            const value = cy.expose(FILTER_KEY);
            if (value) return value;
        }
    } catch (err) {
        // Falls through to the older reader below.
    }
    try {
        if (cy && typeof cy.env === 'function') return cy.env(FILTER_KEY) || null;
    } catch (err) {
        return null;
    }
    return null;
}

// The picker writes spec paths with forward slashes. Cypress reports the running
// spec with the separator the operating system uses, which is a backslash on
// Windows, so one of the two has to be made to match the other.
function selectedFor(filter, relative) {
    if (!filter || !relative) return [];
    return filter[relative.replace(/\\/g, '/')] || [];
}

function installFilter({ globals, selected }) {
    if (!selected || selected.length === 0) return;

    const stack = [];

    const wrapSuite = (original) => {
        const wrapped = function (title, ...rest) {
            const path = stack.concat(String(title));
            if (!shouldRegisterSuite(path, selected)) return undefined;

            const last = rest[rest.length - 1];
            if (typeof last !== 'function') return original.call(this, title, ...rest);

            const body = rest.slice();
            body[body.length - 1] = function (...args) {
                stack.push(String(title));
                try {
                    return last.apply(this, args);
                } finally {
                    stack.pop();
                }
            };
            return original.call(this, title, ...body);
        };
        // only and skip keep their own meaning, so they are passed through untouched.
        wrapped.only = original.only;
        wrapped.skip = original.skip;
        return wrapped;
    };

    const wrapTest = (original) => {
        const wrapped = function (title, ...rest) {
            if (!shouldRegisterTest(stack.slice(), selected)) return undefined;
            return original.call(this, title, ...rest);
        };
        wrapped.only = original.only;
        wrapped.skip = original.skip;
        return wrapped;
    };

    for (const name of ['describe', 'context']) {
        if (typeof globals[name] === 'function') globals[name] = wrapSuite(globals[name]);
    }
    for (const name of ['it', 'specify']) {
        if (typeof globals[name] === 'function') globals[name] = wrapTest(globals[name]);
    }
}

// Runs when a host project imports this file. Guarded so that requiring the module
// in Node, which the tests do, installs nothing.
if (typeof Cypress !== 'undefined' && typeof window !== 'undefined') {
    const filter = decode(readFilterText(Cypress));
    installFilter({
        globals: window,
        selected: selectedFor(filter, Cypress.spec && Cypress.spec.relative),
    });
}

module.exports = { installFilter, selectedFor, readFilterText };
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/support-wrap.test.js
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add support/index.js test/support-wrap.test.js
git commit -m "$(cat <<'MSG'
feat: the browser side filter

Contexts that were not ticked are never registered, so they produce no test and
no pending entry in a report. With no filter present it changes nothing. The only
and skip forms are passed through untouched, because Mocha's only beats this and
the picker warns about that instead.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: The command itself

**Files:**
- Create: `bin/cypress-pick.js`
- Create: `src/run.js`
- Create: `src/cli.js`
- Create: `runner.js`
- Test: `test/runner.test.js`

**Interfaces:**
- Consumes: every module above
- Produces:
  - `applyPick(args: string[], env) => string[]`
  - `main(argv: string[], { cwd, stdout, stdin }) => Promise<number>` the exit code

- [ ] **Step 1: Write the failing tests for applyPick**

Create `test/runner.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { applyPick } = require('../runner');

test('with no picker variables the arguments come back untouched', () => {
    const args = ['cypress', 'run'];
    assert.deepEqual(applyPick(args, {}), args);
});

test('it adds the spec list', () => {
    const out = applyPick(['cypress', 'run'], { CYPICK_SPEC: 'a.cy.js,b.cy.js' });
    assert.deepEqual(out, ['cypress', 'run', '--spec', 'a.cy.js,b.cy.js']);
});

test('it adds the filter on the flag it was told to use', () => {
    const out = applyPick(['cypress', 'run'], {
        CYPICK_SPEC: 'a.cy.js',
        CYPICK_FILTER: 'eyJhIjoxfQ',
        CYPICK_FLAG: '--expose',
    });
    assert.deepEqual(out.slice(2), ['--spec', 'a.cy.js', '--expose', 'cypressPick=eyJhIjoxfQ']);
});

test('it uses the env flag when told to', () => {
    const out = applyPick(['cypress', 'run'], {
        CYPICK_SPEC: 'a.cy.js',
        CYPICK_FILTER: 'eyJhIjoxfQ',
        CYPICK_FLAG: '--env',
    });
    assert.equal(out[4], '--env');
});

test('a spec flag already on the command line wins', () => {
    // The person typed a spec on the command line, so that is what they meant.
    const out = applyPick(['cypress', 'run', '--spec', 'typed.cy.js'], { CYPICK_SPEC: 'picked.cy.js' });
    assert.deepEqual(out, ['cypress', 'run', '--spec', 'typed.cy.js']);
});

test('it does not change the array it was given', () => {
    const args = ['cypress', 'run'];
    applyPick(args, { CYPICK_SPEC: 'a.cy.js' });
    assert.deepEqual(args, ['cypress', 'run']);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/runner.test.js
```

Expected: FAIL, cannot find module `../runner`.

- [ ] **Step 3: Write `runner.js`**

```js
'use strict';

const { FILTER_KEY } = require('./src/build-args');

// For a project whose own script builds the Cypress command, such as a script that
// chains several commands together. There is no single place to add an argument to
// such a chain, so the picked specs travel in environment variables and the
// project's runner adds the flags itself:
//
//   const { applyPick } = require('cypress-pick/runner');
//   return applyPick(args, env);
//
// The variables are named CYPICK rather than CYPRESS because Cypress claims the
// CYPRESS prefix for its own configuration and environment overrides.
function applyPick(args, env) {
    const source = env || process.env;
    if (!source.CYPICK_SPEC) return args;

    const out = args.slice();
    const hasSpec = out.some((a) => a === '--spec' || a === '-s' || a.startsWith('--spec='));
    if (!hasSpec) out.push('--spec', source.CYPICK_SPEC);
    if (source.CYPICK_FILTER) {
        out.push(source.CYPICK_FLAG || '--expose', FILTER_KEY + '=' + source.CYPICK_FILTER);
    }
    return out;
}

module.exports = { applyPick };
```

- [ ] **Step 4: Run them to verify they pass**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/runner.test.js
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Write `src/run.js`**

```js
'use strict';

const { spawnSync } = require('node:child_process');

// shell is on because the commands are npx and npm, which on Windows are batch
// files and cannot be started without one.
function runCypress(args, { cwd }) {
    const result = spawnSync('npx', ['cypress', 'run', ...args], { cwd, stdio: 'inherit', shell: true });
    return result.status === null ? 1 : result.status;
}

function runNpmScript(name, { cwd, env }) {
    const result = spawnSync('npm', ['run', name], {
        cwd,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, ...env },
    });
    return result.status === null ? 1 : result.status;
}

module.exports = { runCypress, runNpmScript };
```

- [ ] **Step 6: Write `src/cli.js`**

```js
'use strict';

const path = require('node:path');
const { readHost, findSpecs, isSupportInstalled, DEFAULT_SPEC_PATTERN } = require('./host-config');
const { scanFile } = require('./spec-scan');
const { createState, toPickedSpecs, warnings } = require('./list-state');
const { promptList } = require('./checkbox-list');
const { buildSelection, buildArgs, buildEnv } = require('./build-args');
const { runnableScripts } = require('./npm-scripts');
const { runCypress, runNpmScript } = require('./run');

const HELP = [
    '',
    '  cypress-pick   tick the specs and contexts you want, then run only those',
    '',
    '  Usage',
    '    cypress-pick [options] [-- any cypress run flags]',
    '',
    '  Options',
    '    --spec-pattern <glob>   where to look for spec files, instead of the',
    '                            pattern in the Cypress config',
    '    --cwd <path>            the project to read, instead of this folder',
    '    -h, --help              show this',
    '',
    '  Anything after -- is passed to cypress run, for example:',
    '    cypress-pick -- --browser chrome',
    '',
].join('\n');

function parseArgs(argv) {
    const options = { passthrough: [], specPattern: null, cwd: null, help: false };
    const rest = argv.slice();
    while (rest.length > 0) {
        const arg = rest.shift();
        if (arg === '--') { options.passthrough = rest.splice(0); break; }
        else if (arg === '-h' || arg === '--help') options.help = true;
        else if (arg === '--spec-pattern') options.specPattern = rest.shift();
        else if (arg === '--cwd') options.cwd = rest.shift();
        else options.passthrough.push(arg);
    }
    return options;
}

// A second list, reusing the same widget, so the run mode is picked the same way the
// specs were. Running Cypress directly is always first because it needs no setup in
// the host project.
async function chooseHow(scripts, { stdout, stdin }) {
    const choices = [{ relative: 'run cypress directly', tests: 0, suites: [] }].concat(
        scripts.map((s) => ({ relative: 'npm run ' + s.name, tests: 0, suites: [] }))
    );
    const state = await promptList(createState(choices), {
        title: 'How should it run? Move to one, press space, then enter.',
        stdout,
        stdin,
    });
    if (!state) return null;
    const picked = state.specs.findIndex((s) => s.checked);
    if (picked <= 0) return { kind: 'cypress' };
    return { kind: 'script', name: scripts[picked - 1].name };
}

async function main(argv, { cwd = process.cwd(), stdout = process.stdout, stdin = process.stdin } = {}) {
    const options = parseArgs(argv);
    if (options.help) { stdout.write(HELP); return 0; }

    const root = options.cwd ? path.resolve(options.cwd) : cwd;
    const host = readHost(root);
    if (options.specPattern) host.specPattern = [options.specPattern];

    const files = findSpecs(root, host);
    if (files.length === 0) {
        stdout.write('\n  No spec files found under ' + host.specPattern.join(', ') + '\n');
        stdout.write('  Use --spec-pattern to say where they are.\n\n');
        return 1;
    }

    if (!host.configRead) {
        stdout.write('\n  The Cypress config could not be read, so the default pattern ' +
            DEFAULT_SPEC_PATTERN + ' was used.\n');
    }

    const supportInstalled = isSupportInstalled(root, host);
    const scanned = files.map((relative) => {
        const result = scanFile(path.join(root, relative));
        return {
            relative,
            tests: result.tests,
            suites: supportInstalled ? result.suites.filter((s) => s.depth >= 1) : [],
        };
    });

    if (!supportInstalled) {
        stdout.write('\n  Contexts are not listed, because ' + (host.supportFile || 'the Cypress support file') +
            ' does not import this package.\n  Add this line to it to pick contexts as well as specs:\n\n' +
            "    import 'cypress-pick/support'\n");
    }

    if (!stdin.isTTY) {
        stdout.write('\n  This needs an interactive terminal. Run Cypress directly instead, for example:\n\n' +
            '    npx cypress run --spec ' + files[0] + '\n\n');
        return 1;
    }

    const total = scanned.reduce((sum, s) => sum + s.tests, 0);
    const title = 'cypress-pick        ' + files.length + ' specs, ' + total + ' tests';
    const state = await promptList(createState(scanned), { title, stdout, stdin });
    if (!state) { stdout.write('\n  Nothing run.\n'); return 0; }

    const selection = buildSelection(toPickedSpecs(state));
    if (selection.specs.length === 0) {
        stdout.write('\n  Nothing was ticked, so nothing was run.\n');
        return 1;
    }

    for (const line of warnings(state)) stdout.write('\n  ' + line + '\n');

    // A project with no package.json of its own is unusual but possible, and it is
    // not a reason to stop: running Cypress directly still works.
    let hostPackage = {};
    try {
        hostPackage = require(path.join(root, 'package.json'));
    } catch (err) {
        hostPackage = {};
    }
    const scripts = runnableScripts(hostPackage);
    const how = scripts.length === 0 ? { kind: 'cypress' } : await chooseHow(scripts, { stdout, stdin });
    if (!how) { stdout.write('\n  Nothing run.\n'); return 0; }

    const version = { cypressMajor: host.cypressMajor === null ? 16 : host.cypressMajor };
    if (how.kind === 'cypress') {
        return runCypress(buildArgs(selection, version).concat(options.passthrough), { cwd: root });
    }
    return runNpmScript(how.name, { cwd: root, env: buildEnv(selection, version) });
}

module.exports = { main, parseArgs };
```

- [ ] **Step 7: Write `bin/cypress-pick.js`**

```js
#!/usr/bin/env node
'use strict';

const { main } = require('../src/cli');

main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
        process.stdout.write('\n  cypress-pick stopped: ' + err.message + '\n\n');
        process.exitCode = 1;
    });
```

- [ ] **Step 8: Check the three paths that do not open the list**

```bash
cd /c/Users/User/Documents/code/cypress-pick
node bin/cypress-pick.js --help
node bin/cypress-pick.js --cwd C:/Users/User/Documents/code/cypress-pick
echo "" | node bin/cypress-pick.js --cwd C:/Users/User/Documents/code/konjuur-cypress
```

Expected, in order: the help text and exit 0; the "no spec files found" message and exit 1, because this repo is not a Cypress project; the message about contexts not being listed followed by the message about needing an interactive terminal, and exit 1.

- [ ] **Step 9: Run the whole test suite**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/
```

Expected: PASS, every file, 70 tests in total: 11 for match, 6 for the codec, 8 for the scanner, 11 for the arguments, 12 for the list state, 5 for the scripts reader, 6 for the host reader, 5 for the browser filter and 6 for the runner.

- [ ] **Step 10: Commit**

```bash
git add bin/ src/cli.js src/run.js runner.js test/runner.test.js
git commit -m "$(cat <<'MSG'
feat: the cypress-pick command

Reads the host project, shows the list, asks how to run, then starts Cypress or
one of the project's own scripts. Says what to do rather than hanging when there
is no interactive terminal, nothing is ticked, or the support file is not
imported.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 11: Install it into konjuur-cypress and prove it on a real run

Everything so far is checked against stand-ins. This is the task that proves the two halves meet.

**Files:**
- Modify: `C:\Users\User\Documents\code\konjuur-cypress\package.json`
- Modify: `C:\Users\User\Documents\code\konjuur-cypress\cypress\support\e2e.js`
- Modify: `C:\Users\User\Documents\code\konjuur-cypress\scripts\run-cypress.js`
- Modify: `C:\Users\User\Documents\code\konjuur-cypress\CLAUDE.md`

**Interfaces:**
- Consumes: `applyPick` from `cypress-pick/runner`, `cypress-pick/support`
- Produces: nothing other projects use

- [ ] **Step 1: Install the package by local path**

```bash
cd /c/Users/User/Documents/code/konjuur-cypress
npm install --save-dev file:../cypress-pick
node -e "console.log(require('cypress-pick/package.json').version)"
```

Expected: `0.1.0`. The dependency in `package.json` reads `"cypress-pick": "file:../cypress-pick"`, which is correct while it is unpublished and is replaced with a version number once it is on npm.

- [ ] **Step 2: Add the support import**

In `cypress/support/e2e.js`, after the `import 'cypress-real-events'` line:

```js
// cypress-pick, so that `npm run pick` can run part of a spec rather than all of it.
// With no picked contexts this changes nothing, which is why it is safe to leave in
// place for every run.
import 'cypress-pick/support'
```

- [ ] **Step 3: Add the hook to the project's runner**

`scripts/run-cypress.js` builds the arguments for every headless run in this project, including the ones inside a chain such as `test:evidence`. Replace its `buildArgs` with:

```js
const { applyPick } = require('cypress-pick/runner');

function buildArgs(cliArgs, env) {
  const args = ['cypress', 'run', ...cliArgs];
  const hasSpecFlag = cliArgs.some((a) => a === '--spec' || a.startsWith('--spec='));

  if (!hasSpecFlag && env.SPEC) {
    args.push('--spec', env.SPEC);
  }

  // When cypress-pick started this run, it adds the picked specs and contexts.
  // When it did not, this returns the arguments unchanged.
  return applyPick(args, env);
}
```

- [ ] **Step 4: Add the script**

In `package.json`, next to `headless`:

```json
"pick": "cypress-pick",
```

- [ ] **Step 5: Check that nothing changed for an ordinary run**

The first thing to prove is that the package is invisible when it is not being used. `website-map.cy.js` is the right subject: 10 tests, one suite, and fast.

```bash
cd /c/Users/User/Documents/code/konjuur-cypress
npx cypress run --spec cypress/e2e/konjuur/website-map.cy.js 2>&1 | tail -20
```

Expected: 10 passing, exactly as before the package was installed.

- [ ] **Step 6: Run the picker for real on the 286 spec**

```bash
cd /c/Users/User/Documents/code/konjuur-cypress
npm run pick
```

In the list: move to `forecasted-cost-konjuur-286.cy.js`, press right to open it, press space on context `A. Card structure and static content` and on context `B. Dynamic component rows`, leave C and D unticked, confirm E shows as skipped and cannot be ticked, press enter, choose `run cypress directly`, press enter.

Expected, and each of these is a separate thing to confirm:

- [ ] The command printed includes `--spec cypress/e2e/konjuur/forecasted-cost-konjuur-286.cy.js` and `--expose cypressPick=`
- [ ] The run reports the tests of contexts A and B only
- [ ] It reports no pending tests, because unticked contexts are not registered rather than skipped
- [ ] The count matches what the picker showed for A plus B

If the run reports all 24 tests, the filter did not reach the browser. Check in this order: that `import 'cypress-pick/support'` is in the support file, that the flag is on the command line, and that `Cypress.spec.relative` matches the key in the filter once backslashes are turned into forward slashes.

- [ ] **Step 7: Run the picker through one of the project's scripts**

```bash
cd /c/Users/User/Documents/code/konjuur-cypress
npm run report:clean
npm run pick
```

Tick the same two contexts, then choose `npm run test:report`.

Expected: the same two contexts run, and a PDF is produced at the end by the project's own report step. That is what proves the environment variable route works through a chained script.

- [ ] **Step 8: Check the project's own filter invariant still reads the same**

This project counts temporary filters left behind in spec files, and the count is written down in its `CLAUDE.md`. Nothing in this task should move it.

```bash
cd /c/Users/User/Documents/code/konjuur-cypress
grep -rnE '\b(it|context|describe)\.(only|skip)\(' cypress/e2e/konjuur/*.cy.js | wc -l
git status --short
```

Expected: 19, the figure recorded in `CLAUDE.md` on 2026-11-10. The changed files are only `package.json`, `package-lock.json`, `cypress/support/e2e.js`, `scripts/run-cypress.js` and `CLAUDE.md`. No spec file is changed.

- [ ] **Step 9: Write it into the project's CLAUDE.md**

Add to the `Running the suite` section, after the block of `npm run` commands:

```markdown
**Pick what to run instead of typing a path.** `npm run pick` lists every spec with
its test count, and opens to the contexts inside a spec. Tick what you want, choose
how to run it, and only that runs. It never edits a spec file, so it replaces the
`.only` habit that this file warns about twice.

Ticking a spec and not opening it runs the whole spec, and passes no filter at all,
so that path is identical to `npm run headless` with a `--spec`. Opening a spec and
unticking some contexts narrows it. Unticking all of them drops the spec.

A context carrying `.only` is flagged in the list and warned about before the run,
because Mocha's `.only` beats the picker. While `confirmed-bugs.cy.js` carries
`context.only('Sprint 4')`, ticking that spec runs 27 tests and not 48, and the
picker says so.

The package is `cypress-pick`, built in `C:\Users\User\Documents\code\cypress-pick`
and installed here by local file path until it is published. Three things wire it in
and all three have to stay: the `pick` script, `import 'cypress-pick/support'` in
`cypress/support/e2e.js`, and the `applyPick` call in `scripts/run-cypress.js` that
makes the picked specs reach a chained script such as `test:evidence`.
```

- [ ] **Step 10: Commit, in both repositories**

```bash
cd /c/Users/User/Documents/code/konjuur-cypress
git add package.json package-lock.json cypress/support/e2e.js scripts/run-cypress.js CLAUDE.md
git commit -m "$(cat <<'MSG'
feat: add npm run pick, an interactive spec and context picker

Lists every spec with its test count, opens to the contexts inside one, and runs
only what is ticked. No spec file is edited, so it replaces the .only habit this
project has had to warn about twice.

Three things wire it in: the pick script, the support import, and the applyPick
call in scripts/run-cypress.js that carries the picked specs through a chained
script such as test:evidence.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"

cd /c/Users/User/Documents/code/cypress-pick
git add -A
git commit --allow-empty -m "$(cat <<'MSG'
test: verified end to end against konjuur-cypress

Two of the five contexts in forecasted-cost-konjuur-286.cy.js, run both directly
and through a chained npm script. An ordinary run with no picking is unchanged.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 12: README and publishing preparation

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `.npmignore` or confirm the `files` list in `package.json` covers it
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: a package that `npm publish --dry-run` accepts

- [ ] **Step 1: Write the README**

Replace the example list below with a real one, copied from the output of `npm run pick` in `konjuur-cypress`, so what the page shows is what the package actually draws.

````markdown
# cypress-pick

Tick the Cypress specs you want, then run only those. Open a spec and you can tick
the contexts inside it too, so you can run part of a large spec without editing it.

```
  cypress-pick              19 specs, 764 tests

  [ ] audit-logs.cy.js                          34
  [x] confirmed-bugs.cy.js                      48
  [~] forecasted-cost-konjuur-286.cy.js         31
      [x] A. Card structure and static content
      [x] B. Dynamic component rows
      [ ] C. Status gating and route differences
      [ ] D. Update Pricing
       -  E. Values, labels and cell behaviour   skipped
> [ ] login-konjuur-79.cy.js                    23
  [ ] project-approvals.cy.js                   52

  [x] whole spec   [~] some contexts   [ ] not running
  up/down move   space tick   right open   left close   a all   n none
  enter run   q quit
```

## Install

```bash
npm i -D cypress-pick
```

Add one line to your Cypress support file, usually `cypress/support/e2e.js`:

```js
import 'cypress-pick/support'
```

That line is what makes context picking possible. Without it you can still pick whole
spec files, and the command tells you what to add. With no contexts picked it changes
nothing, so it is safe to leave in place for every run.

Then run it:

```bash
npx cypress-pick
```

Or add a script, which is shorter to type:

```json
"scripts": {
  "pick": "cypress-pick"
}
```

## What ticking means

| You do this | What runs |
|---|---|
| Tick a spec, never open it | The whole spec. No filter is passed to Cypress at all |
| Tick a spec, open it, untick some contexts | Only the contexts still ticked. The spec shows `[~]` |
| Untick every context in a spec | Nothing. The spec is dropped from the run |
| Tick nothing | It refuses to run and says so |

Contexts are a way of narrowing. You never have to open one.

## Two ways it runs

After you press enter it asks how to run. **Run Cypress directly** needs no setup and
builds the command itself:

```
cypress run --spec <your picks> --expose cypressPick=<the contexts you ticked>
```

Anything after `--` is passed through, for example `cypress-pick -- --browser chrome`.

**Run one of your own scripts** is for a project whose real command is a chain, such as
one that cleans a report folder, runs the tests, then builds a report. There is no
single place to add an argument to a chain, so the picks travel in environment
variables and your own runner adds the flags:

```js
const { applyPick } = require('cypress-pick/runner');

// applyPick adds --spec and the context filter when cypress-pick started this run,
// and returns the arguments unchanged when it did not.
const args = applyPick(['cypress', 'run', ...yourArgs], process.env);
```

The variables are `CYPICK_SPEC`, `CYPICK_FILTER` and `CYPICK_FLAG`. They are not named
with the `CYPRESS_` prefix, because Cypress claims that prefix for its own settings.

## About only and skip

No spec file is ever edited, moved or written to.

A context carrying `.skip` is shown greyed and cannot be ticked, because ticking it
would promise tests that will not run.

A context carrying `.only` is flagged, and a line prints before the run saying what
will actually happen, for example:

```
confirmed-bugs.cy.js carries only on 'Sprint 4', so 27 of its 48 tests will run
whatever is ticked here.
```

Mocha's `.only` beats anything this package does, so it says so rather than pretending
otherwise.

## Cypress versions

Works with Cypress 16 and above, and with earlier versions back to 10.

Cypress 16 removed `Cypress.env()` and added an `--expose` flag in its place, so the
package reads your installed version and uses whichever of the two fits. You do not
have to configure this.

## What it does not do yet

- Picking individual tests rather than contexts
- Remembering your last selection
- The Cypress window, which is a different way of working
- Component testing

## Licence

MIT
````

- [ ] **Step 2: Add the MIT licence text**

Create `LICENSE` with the standard MIT text, year 2026, author Esmeraldo de Guzman Jr.

- [ ] **Step 3: Check what would be published**

```bash
cd /c/Users/User/Documents/code/cypress-pick
npm publish --dry-run 2>&1 | tail -40
```

Expected: `bin`, `src`, `support`, `runner.js`, `README.md`, `LICENSE` and `package.json`. The `test` and `docs` folders must **not** be in the list. If they are, the `files` list in `package.json` is wrong.

- [ ] **Step 4: Check it installs cleanly from a packed file**

A local file install can hide a packaging mistake, because it links rather than copies. Packing and installing the tarball is what a real install does.

```bash
cd /c/Users/User/Documents/code/cypress-pick
npm pack
cd /c/Users/User/AppData/Local/Temp
rm -rf cypick-check && mkdir cypick-check && cd cypick-check
npm init -y >/dev/null
npm install /c/Users/User/Documents/code/cypress-pick/cypress-pick-0.1.0.tgz
node -e "
console.log(typeof require('cypress-pick/runner').applyPick);
console.log(typeof require('cypress-pick/support').installFilter);
"
npx cypress-pick --help
```

Expected: `function` twice, and the help text. Then remove the check folder and the `.tgz`.

- [ ] **Step 5: Run the whole test suite one more time**

```bash
cd /c/Users/User/Documents/code/cypress-pick && node --test test/
```

Expected: PASS, every file.

- [ ] **Step 6: Commit**

```bash
git add README.md LICENSE package.json
git commit -m "$(cat <<'MSG'
docs: README and licence, ready to publish

Checked with npm publish --dry-run and by installing the packed file into an
empty project, which a local file install would not have caught.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Verification summary

| What | How |
|---|---|
| The filter reaches the browser at file load time | Task 1, a probe spec run against Cypress 16.1.0 |
| The matching rule | Task 2, 11 tests |
| The encoding survives the command line | Task 3, 6 tests |
| Suites are read correctly out of real spec files | Task 4, 8 tests plus a check against all 19 specs in `konjuur-cypress`, 764 tests |
| A whole spec pick passes no filter | Task 5, 11 tests |
| Ticking, unticking and the partial state | Task 6, 12 tests |
| The list draws and responds | Task 7, a checklist run by hand |
| Reading an unknown project | Task 8, 11 tests plus a check against `konjuur-cypress` |
| Unticked contexts never register | Task 9, 5 tests against a stand-in for Mocha |
| The command's three non-interactive paths | Task 10, run by hand |
| The two halves meet, on a real run | Task 11, two contexts of the 286 spec, run directly and through a chained script |
| The published package is complete | Task 12, `npm publish --dry-run` and a packed install |
