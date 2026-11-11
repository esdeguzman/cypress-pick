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

This is a real list, drawn from a 19 spec, 764 test Cypress project. Ticking contexts A
and B above and running the pick ran 11 tests, not the 24 that spec normally schedules,
and nothing was reported as pending. The same result came through a project's own
chained npm script, using the environment variable route described below.

## Install

```bash
npm i -D cypress-pick
```

Add one line to your Cypress support file, usually `cypress/support/e2e.js`:

```js
import 'cypress-pick/support'
```

That line is what lets context level picking work. Without it you can still pick whole
spec files, and the command tells you the exact file to add the line to. With no
contexts picked it changes nothing, so it is safe to leave in place for every run.

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

If your own script also has a fallback that adds a spec flag from somewhere else, such
as its own environment variable, call `applyPick` first and let your fallback run only
after it, and only if no spec flag is present yet. Picking a spec is something a person
just did on purpose; a variable left over from an earlier day is not, so it must never
be allowed to beat it. This was a real failure: a run meant for one spec ran a different
one instead, because the fallback was added before `applyPick` and so always won.

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

Works with Cypress 16 and above. This has been verified against Cypress 16.1.0 on a
real project.

Cypress 16 removed `Cypress.env()` and added an `--expose` flag in its place, so the
package reads your installed version and uses whichever of the two fits. You do not
have to configure this.

Earlier versions, back to 10, are expected to work through the `--env` route instead,
since that is the flag Cypress used before 16. This has not been tested, so treat it as
expected rather than confirmed.

## What it does not do yet

- Picking individual tests rather than contexts
- Remembering your last selection
- The Cypress window, which is a different way of working
- Component testing

## Licence

MIT
