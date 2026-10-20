# ADR-0096 — The edit loop is the near wave without lint, at distance 0-1

**Status:** accepted
**Date:** 2026-10-20
**Relates to:** [ADR-0043](0043-an-extension-does-not-own-its-host.md),
[spec 0098](../../specs/0098-the-runner-is-handed-its-selection.md),
[`.agents/references/pre-verify.md`](../../../.agents/references/pre-verify.md)

## Context

An agent that edits ten times between runs needs an answer after each edit that
costs seconds. `yarn verify:near` is that answer for the whole branch, with lint
and the range `0-2`.

## Decision

**`yarn test:loop` is a `package.json` script: `tsc --build`, `variance index`,
then the tests at distance `0-1`, measured from the text each test last ran
over (`VARIANCE_AUTHORITY_SINCE=`).**

1. **No marker of its own.** Each run folds into the record, so the next run
   selects what differs from what last ran. A new baseline beside the record
   would be a second implementation of "since".
2. **Types are the compiler's.** `tsc --build` is incremental; the loop prints
   what it says and does not sort diagnostics by whose they are.
3. **Tests are the selection at `0-1`:** those that entered the change and
   those one import away. A `declined:` selection runs the whole suite, as
   `verify:near` does.
4. **It is a script, not a `variance` command,** since a command that runs the
   runner is the wrapper ADR-0043 rules out.

## Consequences

The loop claims one thing: the edit did not break its neighbours. Lint,
`verify:near`'s `0-2`, `verify:rules` and `verify:far` keep their place.
Whether `0-1` misses failures `0-2` finds is unmeasured.
