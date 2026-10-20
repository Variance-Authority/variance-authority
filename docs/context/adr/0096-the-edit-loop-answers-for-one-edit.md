# ADR-0096 — The edit loop is the compiler and the unit slice at distance 0-1

**Status:** accepted
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

**`yarn test:loop` is `tools/test-loop.mjs`: `tsc --build` beside `variance
index`, then one reading of the unit slice at `0-1`, and a runner only when that
reading keeps a test.**

1. **The unit slice only.** Integration and chromium tests are slow because of
   what they start, not because of how many there are. They belong to the
   waves. `tools/slices.mjs` defines what a slice holds, and both
   `vitest.config.mts` and the loop read it, so the loop's slice and the
   runner's are the same slice.
2. **One reading, by the function every seam calls.** The script calls
   `selectSuite` once. It starts Vitest when the reading declined, when it keeps
   a test the record knows, or when a unit test file was added since the
   record's commit, since the record never saw that file. Otherwise it prints
   one line and exits 0 without starting a runner. On the measurement machine,
   a run with no change takes 0.8 s; an edit that selects one test takes 3.0 s;
   a type error fails in 1.0 s with no test run.
3. **No marker of its own.** Each run folds into the record, so the next run
   selects what differs from the text each test last ran over. A baseline kept
   beside the record would be a second implementation of "since".
4. **Types are the compiler's.** `tsc --build` is incremental; the loop prints
   what it reports and does not sort diagnostics by whose they are. A red
   compiler ends the run before any test starts.
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
