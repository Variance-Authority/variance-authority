# ADR-0085 — the file graph answers `select` where the record cannot, for a suite that reaches its code by import

**Status:** proposed
**Date:** 2026-10-01
**Amends:** [ADR-0038](0038-a-change-reaches-a-component-through-files.md)
(*the graph never rules a subject out*), for one caller under three conditions
named below; ADR-0038 is left as written
**Relates to:** [ADR-0067](0067-a-run-list-refuses-where-a-skip-list-degrades.md),
[ADR-0076](0076-a-suite-is-declared-and-records-alone.md),
[`select-relations.ts`](../../../packages/cli/src/commands/select-relations.ts),
[`reach-command.ts`](../../../packages/cli/src/commands/reach-command.ts),
[`select.ts`](../../../packages/cli/src/commands/select.ts)

## Context

`variance select` skipped nothing when there was no journal, or when the journal
held no whole observation of any test file. That is every fresh clone, every
repository on its first day, and every suite whose record was lost. In each case
the file graph was already published by `variance index`, and `variance reach
--since` already walked it from the diff with `affectedBy`. Test selection by
imports is how selection works before anything is recorded. The record only
narrows it further. `select` asked the record, heard nothing, and ran
everything, while the answer it needed was one command away.

ADR-0038 forbids the graph from ruling a subject out on its own. That rule was
written for a renderer, where a component reaches a page through more than
imports. It also holds for a suite that reaches its code through pages, servers
and processes. It does not hold for a unit suite, where an import is how a test
reaches its code.

## Decision

**Where the record cannot answer, `select` asks `reach`'s walk, and turns its
run list into a skip list.** The walk is `reachedSince`, extracted from `reach`
unchanged, so the two commands cannot disagree about what a change reached, and
each refusal `reach` makes is a reason `select` gives for skipping nothing.

A file nothing imports is an entry: a test file, a story, a script. One the walk
did not reach is skipped, with one exception. If something it loads, at any
depth, could not be read whole, the file stays in the run. `affectedBy` leaves an
unread edge to a recorded run to answer. Here there is no recorded run, so the
file stays in.

It answers only when all three hold:

- **The suite reaches its code by import.** It is undeclared, or declared
  `unit`. A suite declared `integration`, `e2e` or `visual` skips nothing, and
  stderr says why.
- **A ref names where to walk from.** That is the journal's own commit, or
  `--since`. A patch handed in with `--diff` names none.
- **The walk does not refuse.** Each refusal `reach` makes is a decline here,
  with its sentence.

## Consequences

`select` on a fresh clone of a unit suite skips what the change cannot import,
and the first recording narrows it further. An e2e suite with no record still
runs everything. Coverage is the only evidence for such a suite, and it does
not exist yet.

ADR-0067 still holds. The output is still a skip list: a test file the graph
does not hold is in no skip list, so it runs.
