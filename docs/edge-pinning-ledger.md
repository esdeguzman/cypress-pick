# Edge pinning: resume point

The list used to be drawn in the terminal's normal screen and redrawn in place. Every
key pinned it against an edge of the window, ate the lines above it, and made the whole
drawing blink. Commit a895b68 did not fix it. It now draws on a screen of its own.

## Status

| Item | State |
|---|---|
| Cause found | done. Measured in Warp, Command Prompt and Git Bash |
| Fix: the list draws on its own screen | done, `src/checkbox-list.js` |
| Fix: the redraw writes over what is there instead of erasing first | done, same file |
| Tests | 260 pass, including four new ones in `test/search.test.js` and a rewritten one in `test/checkbox-list.test.js` |
| Checked by hand in Warp | waiting |
| Checked by hand in Command Prompt | waiting |
| Checked by hand in Git Bash | waiting |
| Commit | not made |

## The cause

The list was allowed to use every row of the window. `layoutFor` reserved one row, for
the terminal's own cursor, and nothing else:

    room = height - head.length - foot.length - 1

Recorded from the real runs, with `CYPRESS_PICK_TRACE`:

| Terminal | Window | Tallest drawing | Rows left for anything else |
|---|---|---|---|
| Warp | 43 rows | 42 lines, while searching | 0 |
| Command Prompt | 30 rows | 29 lines, while searching | 0 |
| Git Bash | 27 rows | 24 lines | 2 |

The terminal is never empty when the list opens: the command that was typed is on it,
and so is whatever npm printed. A drawing the height of the window pushes that off, the
window scrolls, and once it has scrolled far enough that the top line of the drawing is
the first row of the screen, the redraw cannot reach above it. The title and the blank
line were then overwritten, which is the missing header in the reported screenshots.

The blink was separate: every redraw wrote "erase from here to the end of the screen"
and then wrote the lines, so the screen was briefly empty.

## What was ruled out first, and how

- The redraw arithmetic. Both a terminal model and `test/manual/redraw-probe.js` in
  real Warp showed the cursor landing exactly where the code expects, over several
  redraws of changing height.
- The cursor moving between draws, for example a terminal echoing the key.
  `redraw-probe.js keys` asks the terminal where its cursor is before and after each
  draw. Every row was the expected one, over six keys.
- Another writer. The recording notes anything written to the terminal that is not the
  list. Nothing else wrote.
- Line wrapping. Nothing drawn came within 30 characters of the width.

## The tools, which are worth keeping

- `test/manual/redraw-probe.js` with no argument, `alt`, or `keys`.
- `test/manual/replay-stream.js`, which writes a recording back to a terminal byte for
  byte, with switches to drop the colour or the line length one at a time.
- `CYPRESS_PICK_TRACE=<file>` makes `src/checkbox-list.js` record every write, every
  key, the window size, and anything else that writes to the terminal.

## Decisions and traps

- The list draws on the alternate screen, the one vim and less use. Reserving a few
  rows instead was considered and turned down: any number is a guess, because the
  output above the list can be any height.
- There is no line break after the last line of a drawing. On the last row of the
  screen it would scroll, which is the fault this fixes.
- Wrapping and the cursor are terminal-wide, so both are put back before the screen is
  handed over.
- Writing escape sequences into this repo through a shell heredoc turns `\n` and
  `\u001b` into real control characters. Build them with `chr(92)` in a script, and
  check the file still parses afterwards.
- A test that asserts before it quits the list leaves the run pending and the test file
  hangs. Quit, await the result, then assert. `q` is a letter while a search is being
  typed, so quit with Ctrl+C there.
