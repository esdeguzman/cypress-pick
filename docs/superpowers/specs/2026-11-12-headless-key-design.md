# Headless key design

A key in the spec list that runs the ticked picks through Cypress straight away,
without asking how to run.

## Why

Pressing enter asks a second question: run Cypress directly, or run one of the
project's own scripts. A person who always wants the first answer has to answer
that question every time. This adds one key that gives that answer up front.

## What the key does

`h`, pressed in the spec list, is an accept. It runs exactly what enter would
run, and skips the "How should it run?" list.

| Situation | What happens |
|---|---|
| Specs ticked, `h` pressed | Cypress runs the picks. The mode list never appears |
| Nothing ticked, `h` pressed | "Nothing was ticked, so nothing was run." Exit code 1 |
| A spec carries `.only` | Its warning prints first, as it does on enter |
| A spec was typed after `--` | The typed spec wins, and the notice about the dropped picks prints |
| Flags after `--` | Passed to Cypress, as on enter |

Running Cypress directly is already headless. No `--headless` flag is added.

## What the key costs

`h` stops closing an open spec. The left arrow still closes one. `j`, `k` and
`l` keep their meanings, so only one of the four vim keys changes.

This was a deliberate choice over a free key such as `r`. The key is named for
what it does.

## The list footer

The spec list gains one entry:

```
  [x] whole spec   [~] some contexts   [ ] not running
  up/down move   space tick   right open   left close   a all   n none
  enter run   h headless   q quit
```

The "How should it run?" list does not show it and does not bind it. That list
is a second use of the same widget, with no openable rows, so `h` there keeps
meaning close and does nothing.

## Interfaces

`promptList` has two outcomes today: `null` when the person quit, and the list
state when they accepted. It needs a third, because there are now two ways to
accept.

It will resolve:

- `null`, unchanged, when the person pressed `q` or Ctrl+C
- `{ state, accept }` otherwise, where `accept` is `'ask'` after enter and
  `'headless'` after `h`

A new option, `allowHeadless`, decides whether `h` is bound to the headless
accept and whether the footer names it. It defaults to false. The spec list
passes true. The mode list passes nothing, so it is unchanged.

The alternative was hanging an extra field off the returned state, which would
have left every existing `promptList` test untouched. The shape change was
preferred: a reader of `cli.js` can see where `accept` comes from, and the test
edits are mechanical.

`cli.js` reads `accept`. When it is `'headless'` it uses
`{ how: { kind: 'cypress' }, message: null }` and never calls `chooseHow`. That
is the same value `cli.js` already uses when the host project has no runnable
scripts, so it lands on the existing Cypress branch and no run logic is
duplicated.

Nothing in `list-state.js`, `build-args.js`, `run.js` or `runner.js` changes.

## Tests

| Test | Checks |
|---|---|
| `h` with `allowHeadless` | Resolves `accept: 'headless'`, with the ticks as they stood |
| enter | Resolves `accept: 'ask'` |
| `h` without `allowHeadless` | Closes an open spec, as it does today |
| footer, option on | The line names `h headless` |
| footer, option off | The line does not name it |
| `main`, headless accept | Cypress is launched and the mode list is never drawn |
| `main`, headless accept, nothing ticked | Refuses with the existing message, exit code 1 |

Every existing `promptList` test is updated to read `state` out of the resolved
object.

## Documentation

- The key list in the README sample list
- The README section "Two ways it runs", which says the question is always asked
- The file map note for `src/checkbox-list.js` in the implementation plan
