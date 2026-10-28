# ADR-0096 — The edit loop is the compiler and the unit slice at distance 0-1

**Status:** accepted
**Superseded in part by:** [ADR-0099](0099-the-edit-loop-is-the-published-recipe.md)
**Date:** 2026-10-20
**Relates to:** [ADR-0043](0043-an-extension-does-not-own-its-host.md),
[spec 0098](../../specs/0098-the-runner-is-handed-its-selection.md),
[`.agents/references/pre-verify.md`](../../../.agents/references/pre-verify.md)

## Context

An agent that edits ten times between runs needs an answer after each edit, and
the answer has to cost less than the edit did. `yarn verify:near` answers for
the whole branch: lint, every slice, the range `0-2`. Run after an edit no test
covers, it still pays one Vitest boot per slice (0.55–0.8 s each) to learn that
it has nothing to run, because each slice's seam computes its selection inside
its own runner. An edit that does reach a test can start the chromium slice,
which takes tens of seconds to answer.

## Decision

**`yarn test:loop` is a script under `tools/`: `tsc --build`, then `variance
index` and one reading of the unit slice at `0-1`, and a runner only when that
reading keeps a test.**

1. **The unit slice only.** Integration and chromium tests are slow because of
   what they start, not because of how many there are. They belong to the
   waves. `tools/slices.mjs` defines what a slice holds, and both
   `vitest.config.mts` and the loop read it, so the loop's slice and the
   runner's are the same slice.
2. **One reading, by the function every seam calls, gated by the rule every
   seam keeps files by.** The script calls `selectSuite` once, lists the unit
   test files in the working tree, and starts Vitest when `kept` — the rule the
   seam's headline counts — names any of them: a file the reading does not
   skip. A file that failed last time is never held whole, so it is never
   skipped, and the loop stays red until it passes. A file the record never saw
   is kept the same way, and a declined reading skips nothing. Otherwise the
   script prints what the seam would — the selection's headline and its
   readings — and a verdict naming the distance, and exits 0 without starting
   a runner: a test that already ran this text is kept out, not missing. On the
   measurement machine, a run with no change takes 1.4 s; an edit that selects
   one test takes 3.6 s; a type error fails in 0.4 s with no test run.
3. **No marker of its own.** Each run folds into the record, so the next run
   selects what differs from the text each test last ran over. A baseline kept
   beside the record would be a second implementation of "since".
4. **Types are the compiler's.** `tsc --build` is incremental; the loop prints
   what it reports and does not sort diagnostics by whose they are. A red
   compiler ends the run before any test starts. The reading waits for a green
   compiler, because `selectSuite` and `kept` load from the `dist/` it writes:
   read beside it, an edit to the selection would be answered by the selection
   it replaced.
5. **A script, not a `variance` command,** because a command that runs the
   runner is the wrapper ADR-0043 rules out.

## Consequences

The loop claims one thing: the edit did not break the unit tests within one
import. Lint, `verify:near`'s `0-2` across every slice, `verify:rules` and
`verify:far` keep their place. Whether `0-1` misses failures that `0-2` finds is
unmeasured.

When the runner starts, its seam computes the same selection again, which costs
about 0.3 s. `selectSuite` also decodes the whole source index on every call,
including a call where only prose changed. Both are costs of the read, not of
the loop, and are fixed in the read.
