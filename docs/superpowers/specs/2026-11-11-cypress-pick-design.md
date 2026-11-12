# cypress-pick design

Date: 2026-11-11
Status: agreed, not yet implemented

## 1. What it is

A command that lists a Cypress project's spec files, lets you tick the ones you want,
and runs only those. Ticking can go one level deeper, to the `context` and `describe`
blocks inside a spec, so you can run part of a large spec without editing it.

It is a standalone package, installed into any Cypress project as a development
dependency. It is built in its own repository at
`C:\Users\User\Documents\code\cypress-pick`, consumed by `konjuur-cypress` through a
local file path while it is being built, and published to npm later.

## 2. The problem it solves

Running one spec today means typing a path, and running part of a spec means adding
`.only` to the file and remembering to take it out. A marker left behind makes a run
report success for tests it never scheduled. The `konjuur-cypress` project has had that
bug more than once and now carries a documented check for it.

This command makes the narrowing temporary by construction. It never edits a spec file.

## 3. How a host project installs it

1. `npm i -D cypress-pick`
2. Add one line to the support file, `cypress/support/e2e.js`:

   ```js
   import 'cypress-pick/support'
   ```

3. Optionally add a script: `"pick": "cypress-pick"`

Step 2 is what lets context level picking work. Without it, spec level picking still
works, and the command says so rather than failing. It knows by reading the host's
support file and looking for that import, which is also why the message it prints can
name the exact file to add the line to.

## 4. The list

One screen. Specs at the top level, their contexts nested underneath and collapsed
until opened.

```
  Konjuur spec picker              19 specs, 764 tests

  [ ] audit-logs.cy.js                          34
  [x] confirmed-bugs.cy.js                      48
  [~] forecasted-cost-konjuur-286.cy.js         31
      [x] A. Card structure and static content
      [x] B. Dynamic component rows
      [ ] C. Status gating and route differences
      [ ] D. Update Pricing
      [ ] E. Values, labels and cell behaviour   skipped
> [ ] login-konjuur-79.cy.js                    23
  [ ] project-approvals.cy.js                   52

  [x] whole spec   [~] some contexts   [ ] not running
  up/down move  space tick  -> open  enter run  q quit
```

### Selection rules

| You do this | What runs |
|---|---|
| Tick a spec, never open it | The whole spec. No filter is passed to Cypress at all |
| Tick a spec, open it, untick some contexts | Only the contexts still ticked. The spec row shows `[~]` |
| Untick every context in a spec | Nothing. The spec row returns to `[ ]` and the spec is dropped |
| Tick nothing | The command refuses to launch and says so |

Contexts are a narrowing tool. You never have to open one, and leaving them alone means
run it all. The first row of that table matters: a whole spec pick produces the same
Cypress command the project already uses today, so it cannot behave differently.

### Rows the list marks but does not let you tick

A context carrying `.skip` is shown greyed and cannot be ticked, because ticking it
would promise tests that will not run.

A context carrying `.only` is flagged in the list, and a line prints before the run:

```
confirmed-bugs.cy.js carries context.only('Sprint 4'), so 27 of its 48 tests will run.
```

Mocha's `.only` wins over anything this package does, so the honest thing is to say so
and run anyway. No spec file is edited.

## 5. The two ways it launches a run

### Default: it runs Cypress itself

```
npx cypress-pick
npx cypress-pick --browser chrome
```

It builds `cypress run --spec <paths> --expose <filter>` and adds any extra flags you
gave it. This works in a project with no scripts of its own and no setup beyond step 2
above.

### Script mode: it runs one of your npm scripts

It reads the host `package.json` and offers its scripts. This exists because a project's
real command is often a chain. In `konjuur-cypress`, `test:evidence` is
`report:clean && headless:evidence && report`, and you cannot append an argument to the
middle of a chain.

So the selection travels as two environment variables, `CYPICK_SPEC` and `CYPICK_FILTER`,
and the project's own runner script splices them in:

```js
const { applyPick } = require('cypress-pick/runner');
// applyPick adds --spec and --expose when cypress-pick launched this run, and
// returns the arguments untouched when it did not.
return applyPick(args, env);
```

In `konjuur-cypress` that is a two line change to `scripts/run-cypress.js`.

The variables are deliberately **not** named `CYPRESS_SPEC` or similar. Cypress claims
the whole `CYPRESS_` prefix for its own configuration and environment overrides, so a
name inside that space can be consumed or rejected by Cypress before the project's own
script ever sees it.

## 6. How the filter reaches the browser

The selection is a small JSON object: spec path against the list of ticked context
titles. A spec picked whole has no entry in it. So the rule the browser applies is per
spec, not global: if the spec being read is absent from the object, nothing is filtered
and every one of its tests runs.

It is base64 encoded before being put on the command line. Cypress separates multiple
`--expose` values with commas, so raw JSON would be split apart at its own commas. Base64
has no commas and nothing needing a shell quote.

The support file decodes it and reads it with `Cypress.expose('cypressPick')`, which
returns its value synchronously. That matters: filtering has to happen while the spec
file is being read, before any test is registered.

### Version compatibility

| Host Cypress | Flag used | Read in the browser with |
|---|---|---|
| 16 and above | `--expose cypressPick=<base64>` | `Cypress.expose('cypressPick')` |
| Below 16 | `--env cypressPick=<base64>` | `Cypress.env('cypressPick')` |

Cypress 16 removed `Cypress.env()` and added the `--expose` flag in its place. The
package checks the host's installed Cypress version and picks the right one. The support
file reads whichever of the two exists. This is what lets the same package drop into
projects that are on different Cypress versions.

The usual package for this kind of filtering, `@cypress/grep`, calls `Cypress.env()` and
therefore does not work on Cypress 16 at all.

### What the support file does

With no filter present it does nothing, and every existing way of running the project is
unaffected.

With a filter, and only for a spec that has an entry in it, it keeps track of the suite
titles it is currently inside, and registers a `describe` or `context` only when its full
title path is on the ticked list, or is a parent or a child of something on the list. A
context that is not registered produces no test and no pending entry, so reports stay
clean.

It does not touch `.skip` or `.only`, which keep their normal meaning.

## 7. Finding the specs in an unknown project

It reads the host's Cypress config for `specPattern` and `excludeSpecPattern`. ~~If the
config cannot be read, which happens with a TypeScript config file, it falls back to
Cypress's own default glob and says that it did.~~ **Corrected: whether a TypeScript
config can be read depends on the Node version running the command, not on the file being
TypeScript.** ~~Node 22.6 and later strip the types and load it like any other config; an
earlier Node cannot load it at all.~~ **Corrected again 2026-11-12: 22.6 is the wrong
line. It added the option, which has to be asked for, and the plain `require` used here
never asks for it. The versions that load a TypeScript config with no flag are Node 22.18
and later, and Node 23.6 and later.** Either way the result is handled: read it when it can
be read, and fall back to Cypress's own default glob and say that it did when it cannot. A
`--spec-pattern` flag overrides both.

It handles `.cy.js`, `.cy.ts`, `.cy.jsx` and `.cy.tsx`.

Context titles are read by scanning each file for `describe` and `context` calls and
tracking brace depth to work out nesting. A title built from a variable or a template
string cannot be read this way; those rows are listed as unreadable and the spec can
still be ticked whole.

## 8. The pieces

| File | What it does | Depends on |
|---|---|---|
| `bin/cypress-pick.js` | The command. Nothing but a call into `src/cli.js` | cli |
| `src/cli.js` | Reads flags, calls the others in order, launches | all of the below |
| `src/spec-scan.js` | Finds spec files and reads their contexts | the file system |
| `src/checkbox-list.js` | Draws the list and handles keys | nothing |
| `src/list-state.js` | Key plus current state gives next state. Plain function | nothing |
| `src/npm-scripts.js` | Reads the host `package.json` scripts | the file system |
| `src/build-args.js` | Selection gives Cypress arguments. Plain function | nothing |
| `src/match.js` | Title path plus selection gives true or false. Plain function | nothing |
| `src/run.js` | Spawns Cypress or an npm script | nothing |
| `support/index.js` | The browser side filter | `src/match.js` |
| `runner.js` | `applyPick` for host runner scripts | `src/build-args.js` |

`src/match.js` is used in both Node and the browser, which is what makes the filtering
rule testable without a browser.

## 9. When things go wrong

| Situation | What happens |
|---|---|
| Not an interactive terminal, such as CI or a pipe | Prints the equivalent command and exits 1, rather than hanging |
| `q` or Ctrl+C | Restores the cursor and the terminal mode, exits 0, runs nothing |
| Nothing ticked | Refuses to launch and says so |
| No spec files found | Reports the pattern it searched and exits 1 |
| Support file not installed | Context rows are listed but not tickable, with one line saying how to enable them |
| Cypress finishes | The command exits with Cypress's own exit code, so a chain using `&&` still behaves |

## 10. How it is verified

`spec-scan`, `build-args`, `npm-scripts`, `match` and `list-state` are plain functions
with tests under Node's built in runner, `node --test`. No test framework is added. Only
the drawing code is untested.

The first thing built, before any of the above, is a check that the flag reaches the
browser: run a throwaway spec with `--expose cypressPick=<base64>` and confirm
`Cypress.expose` returns it. The rest of the design depends on that behaving as
documented, so it is worth finding out on day one.

Then the package is installed into `konjuur-cypress` by local file path and run for
real: tick two of the five contexts in `forecasted-cost-konjuur-286.cy.js` and confirm
the run reports those tests and no others.

## 11. Not in version one

Each of these is noted in the README as a possible later addition.

- Picking individual tests rather than contexts
- Remembering the last selection
- Cypress GUI mode
- Component testing

## 12. Decisions worth keeping

- **No new dependency.** The list is written against Node's own readline. The alternative
  considered was `@inquirer/prompts`, whose checkbox is a flat list and would have made
  this two prompts in sequence rather than one screen.
- **`--expose`, not `@cypress/grep`.** The usual package calls `Cypress.env()`, which
  Cypress 16 removed.
- **Base64, not raw JSON, on the command line.** Cypress splits `--expose` values at
  commas.
- **`CYPICK_` and not `CYPRESS_` for the environment variables.** Cypress claims its own
  prefix.
- **A whole spec pick passes no filter at all.** The common case then produces exactly
  the command the project already runs, so it cannot behave differently from it.
