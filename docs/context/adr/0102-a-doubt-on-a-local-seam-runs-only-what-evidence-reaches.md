# ADR-0102 — a doubt on a local seam runs only what evidence reaches

**Status:** accepted
**Date:** 2026-11-16
**Supersedes in part:** [ADR-0062](./0062-a-skip-list-is-bounded-by-what-the-record-witnessed.md),
its decision that every doubt in the record erases the whole difference, for
the local seams only; the gate keeps it as written
**Relates to:** [spec 0091](../../specs/0091-a-suite-is-selected-by-a-machine.md)
item 5, [ADR-0099](./0099-the-edit-loop-is-the-published-recipe.md),
[`select-local.ts`](../../../packages/cli/src/commands/select-local.ts),
[`selection-safety.md`](../../selection-safety.md)

## Context

ADR-0062 decided that a skip list is the difference between what the record
witnessed whole and what the diff reached, and that every doubt erases the
whole difference: no journal, no coverage, nothing recorded whole, a diff git
cannot produce, an install it cannot compare. Each runs every test file. It
argued from cost: a widening costs at most a full run, the status quo.

That cost is the status quo of a gate, not of an edit loop. `yarn test:loop`
and `yarn verify:near` run after every edit, often from several agents on one
machine, and a doubt there is common: a fresh worktree, a lockfile edit, a
record from a commit no longer reachable. Each turned a loop meant for seconds
into minutes of every core. `--local` already answered most doubts with a
smaller selection, but its rungs were the changed file's package, then the
root: a lockfile or a root file still ran every test file, and a `before` file
ran a package instead of the suite it declares. The seams did not ask for
`--local` at all.

## Decision

**On a local seam, no evidence means no test.** A doubt is named on the first
line and selects only the test files that import a changed file, by the source
index. A changed file the index does not hold selects none and is named; a file
a test reads without importing it is declared with `/// <depends>`. With no
diff from the record, the mainline's merge base or `HEAD`, there is nothing to
select by, and the command exits non-zero. A diff that moves a `before` file
runs the whole suite, because that run is declared, not guessed.

The package and root rungs are deleted. A local seam is `--local` or
`VARIANCE_AUTHORITY_LOCAL=1`; `test:loop` and `verify:near` set it.

**The gate keeps ADR-0062.** `variance select` without `--local`, and the CI
selection of a pull request and of the merge queue, still widen on every doubt.
The push to `main` runs with no selection and skips nothing.

## The backstop, and the misses it carries

ADR-0062's evidence stands: one narrowing that read less than the record held
dropped 3 of 2,000 tests a control run kept, and five selection defects found by
killing mutants each returned a smaller, confident answer. A local seam now
accepts that class of miss on purpose, for a verdict in seconds. It is bounded
twice: the gate on the pull request widens on the same doubt, and the whole run
on `main` skips nothing, so a test a local run left out fails there, late and by
name, never silently in a merge. The local seam is where an agent iterates, not
where a change is accepted.

## What this forecloses

- **A local fallback that widens.** A new reason the record cannot answer adds
  a ground the ladder names, never a rung that runs a package or the suite.
- **A gate that reads `VARIANCE_AUTHORITY_LOCAL`.** `check.yml` does not set it,
  and `tools/loop.check.ts` holds that.
