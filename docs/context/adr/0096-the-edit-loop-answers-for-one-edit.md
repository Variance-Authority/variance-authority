# ADR-0096 — The edit loop answers for one edit

**Status:** accepted
**Date:** 2026-10-20
**Relates to:** [ADR-0043](0043-an-extension-does-not-own-its-host.md),
[spec 0098](../../specs/0098-the-runner-is-handed-its-selection.md),
[`tools/test-loop.mjs`](../../../tools/test-loop.mjs),
[`.agents/references/pre-verify.md`](../../../.agents/references/pre-verify.md)

## Context

`yarn verify:near` is the loop's wave and answers for the branch: `tsc --build`
reports every error in the project, and the selection is measured from the
commit each test last ran at. An agent that edits ten times between runs gets
the same large question each time, and a red does not say which edit caused it.

## Decision

**`yarn test:loop` is a repository script that answers for the edits since its
last green invocation, in two checks that stop at the first red.**

1. **The edit is a marker.** After a green run the script keeps, in the cache,
   `HEAD` and the git blob of every file that differs from it. The next run
   compares against those blobs, and with nothing moved it checks nothing. A
   commit moving `HEAD` discards the marker, and `--reset` removes it. Blobs are written with `git hash-object -w`, which
   never touches the index. A red run leaves the marker, so the failed edit and
   its fix are checked together.
2. **Types are the compiler's.** `tsc --build` is incremental and already
   about a second, so the loop runs it and prints what it says. It does not
   sort diagnostics by whose they are.
3. **Tests are the selection at distance 0-1,** the tests that entered the
   change and those one import from it, `VARIANCE_AUTHORITY_SINCE=` and
   `VARIANCE_AUTHORITY_AT_DISTANCE=0-1`, which the record already measures from
   the text each test last ran over. A `declined:` selection is red: the loop
   never widens to the suite.
4. **It is a script, not a `variance` command,** since a command that runs the
   runner is the wrapper ADR-0043 rules out.

## Consequences

The loop claims one thing: the edit did not break its neighbours. Lint,
`verify:near`'s `0-2` range, `verify:rules` and `verify:far` keep their place.
Distance 1 is a default; whether it misses failures `verify:near` finds is a
measurement still to take.
