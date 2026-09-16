# ADR-0062 — a skip list is bounded by what the record witnessed

**Status:** accepted
**Date:** 2026-09-16
**Relates to:** [journal 0052](../journal/0052-five-ways-the-skip-list-spoke-for-tests-nothing-witnessed.md), [journal 0053](../journal/0053-one-file-cost-four-fifths-of-the-suite.md), [ADR-0056](./0056-a-journey-is-the-places-visited.md)

## Context

Selection is asymmetric in a way nothing else in this repository is. Running a
test that did not need to run costs seconds. **Skipping a test that would have
failed costs the whole idea** — once a suite has silently passed over a real
break, nobody trusts the next green, and the correct response to that distrust is
to stop selecting.

The shape that makes it dangerous is that an empty answer has two readings which
are opposite facts. *Nothing this diff touched was entered by any test* and *this
snapshot recorded no tests at all* arrive as the same empty list. A caller that
narrows on the first while holding the second skips every subject it has, and
nothing in the output looks wrong: a subject that was never recorded is not in
the report to be missing from.

Five separate defects of this exact family were found in one sitting — an
`inert` classification that dropped a re-export edit, an enrichment that deleted
the widening valve, a recorder that silently dropped an uninstrumented peer, a
`bindsOnly` that read an empty body as inert, a merge that swallowed an unreadable
file — and all five were *silent*. Each returned a confident, smaller answer.
That is the evidence this ADR is written from: the failure mode here is not a
crash, it is a smaller number.

## Decision

**A skip list is the difference between what the record witnessed whole and what
the diff reached, and every doubt in the record erases the whole difference.**

`ExecutionNarrowing` returns five fields, and their relationship is the rule.

**`whole` bounds the answer; it is never the suite.** Only tests whose
observation completed are in it. A test that crashed, timed out, or was recorded
with a partial contribution is *unknown*, not untouched, and absence from
`entered` is evidence only for tests that are in `whole`. Callers compute
`skip = whole − entered` and can therefore never skip a test the snapshot does
not speak for.

**`unread` retires the skip list for the whole run.** A changed path nothing
recorded has ever heard of — no row, no precondition, no place in the graph — is
a question the record cannot answer, and it cannot be answered file by file: a
file the snapshot has never seen may be the input the whole suite reads. One
entry in `unread` means run everything. This is why an enrichment may only *add*
to what selection sees and may never replace a valve it does not understand.

**`stale` charges one file whole and leaves the others standing.** A recording is
made by *running* the suite, so its line numbers were cut from whatever was on
disk at that moment, while the position written on it is `git rev-parse HEAD`.
Those agree on a clean tree and nowhere else. A module whose recorded text is not
the text at the index's own commit has line ranges that are coordinates in a
different text, so **every** subject that ever entered it is charged — but only
that module's answer is void. The other files' rows were cut from texts that do
agree, and retiring them too would make every dirty-tree run a full run, which is
every developer run.

**A precondition is unconditional.** A row says which tests crossed which regions
of a text; a precondition says *if this file's text moves at all, retire this
observation*, with no region involved. A row buys a path out of `unread` and
buys nothing else. The tempting narrowing — *a row narrows the declaration for
the tests that entered the module* — was built and measured: it dropped 3 of
2,000 tests a control run kept. Unconditional drops none.

**Every cause is named.** `because` carries the reason each selected test is in
the answer, and `stale` and `unread` are reported by name. A widening a caller
cannot see is a widening nobody will ever narrow again.

## Consequences

The valve is cheap where it matters and expensive only where it should be. Every
widening above costs at most a full run, which is the status quo the tool is
trying to improve on; every narrowing it refuses costs seconds. Measured on a
real recording of Material UI's own suite, 31.6% of source files still cost half
the suite or more and one file costs 78% alone — so the honest framing for both
docs and callers is that **what changed decides the value, not how much changed**,
and a valve that opens on doubt does not move that number much.

It also fixes what "prove it" means here. A test that asserts selection returns
the right set is worth less than a test that asserts a *mutant* is caught: the
five defects above were all found by killing mutants, and `select-check.mjs`
exists to do that before a human does.

## What this forecloses

- **Skipping on an empty answer.** An empty `entered` with an empty `whole` is a
  snapshot that knows nothing, and any caller that cannot tell those apart must
  run everything.
- **Per-file handling of `unread`.** It is a run-level retirement. A future
  caller wanting to charge only the tests "near" an unknown file has to first
  produce evidence that the file cannot be a global input, and there is no such
  evidence available from a record that never saw it.
- **Retiring the run on `stale`.** The opposite error, and the one that makes the
  tool useless in the loop it is for. A dirty tree is the normal state of a
  developer's checkout.
- **An enrichment that replaces rather than adds.** Anything layered onto
  selection — a graph, a relation table, a heuristic — may add causes and may add
  widenings. Removing one is a change to this ADR, not a refinement of a caller.
- **Silent narrowing anywhere downstream.** A classification that decides an edit
  is inert, a merge that skips an unreadable input, a reporter that drops a module
  it could not identify: each must widen or fail loudly. None may quietly answer
  for tests it did not witness.

It does not foreclose narrowing further on better evidence. It forecloses
narrowing on the absence of evidence.
