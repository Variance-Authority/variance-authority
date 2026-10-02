# Spec 0094 — a run writes one record

**Missing:** everything a test run records about its cases lives outside the
record, on code paths of its own.
- **The case index** is a second file, `coverage.bin.cases.bin`. It is landed
  by `layCaseRun` under a second lock, after the snapshot's lock is released
  (`FIXME` at `journal.ts` and `case-fold.ts`). It is seeded only when the
  snapshot was, and its replaced-cases files are never seeded.
  `mainline-layer.ts`, `milestone-repin.ts` and `landCaseIndexes` each handle
  it by hand. It re-encodes the modules and blocks the snapshot already holds.
- **Eyes journals** go to a path the caller chooses (`writeEyesArchive`). They
  are outside the cache, layered by nothing, and absent from a share. `distill`
  reads them only through `--eyes`.
- **Ids do not join.** The Playwright fixture names a test by Playwright's
  opaque `testId`. An Eyes retry is spelled `id #2` and a repeated case name
  `id#1`. Eyes source paths are absolute.
- **A run that instruments nothing writes nothing**, so its cases are lost with
  it.

**Built on:** the section container both files already use (`sections` in
`format-layout.ts`, read by name in `format-view.ts`), [spec 0090](0090-coverage-is-layered.md)
(coverage is layered), [spec 0044](0044-many-writers-one-record.md) (many
writers, one record), the join and retention rules of
[spec 0054](0054-eyes-attention-is-read-as-test-steps.md), and the case
preconditions of [spec 0093](0093-a-case-names-its-preconditions.md).

## Purpose

Coverage, case rows, case preconditions and Eyes journals are recorded by the
same run, at the same moment, about the same cases. What one of them says is
true only of the code the others ran over. Splitting them makes every rule of a
record — layering, seeding, the landing lock, sharding, the share, pruning — a
rule written once per file. Each copy then drifts: the second lock races the
first, a seed copies one file and not its sibling, a share carries two of the
four.

The record is one file: `coverage.bin`, the file every rule already knows.

## What the record holds

Each kind of data is a group of named sections in the one container, laid on
the rows it describes:

| Sections | Grain | Written when |
|---|---|---|
| tests, modules, blocks, file preconditions | test file | the run instrumented modules |
| cases: id, file, name, stopped, duration, attempt | test case | the driver keeps cases |
| case crossings | case × block of this record | the driver keeps cases and instrumented modules |
| case preconditions: name, value, site | test case | a case called `variancePrecondition` |
| Eyes journals | case × attempt | the run opted into Eyes |

- **Crossings point into the record's own blocks.** A case no longer carries a
  second copy of the module table.
- **A section that was not collected is absent, never empty.** A reader answers
  *unmeasured* or *not collected* for an absent section, and never *none*.
- **A record without coverage.** A run that kept cases or Eyes journals but
  instrumented no module still writes the record. Its module sections are
  absent and say so. Selection reads such a record as having no coverage, so it
  narrows nothing.
- **The Eyes journal is in the record only when the run opted in.** Opting in
  keeps the journal in the record on the machine that ran, and no further. The
  record is the run artifact and its access boundary, so no journal leaves
  through a side file.
- **Hosted retention is the share, and only the share.** A record leaves the
  machine that ran only through `variance share` or a configured `carry`, each
  started by the person who owns the boundary it crosses. Either one names the
  Eyes sections among what it uploads, so the person sees the journal go before
  it goes. Opting into Eyes does not authorize that upload, as spec 0054
  requires.

## One identity

A case is named by the case scope, as the probe names it: `file > name`, with
the file repository-relative and a repeated name numbered `#1`. Nothing else
spells a case.

- **An Eyes journal joins its case by that id, exactly.** The case id is the
  stable Eyes test identity spec 0054 asks the writer to keep: a journal row
  carries the case's row in the record and its attempt, and nothing else names
  the case.
- **The attempt is a column, never part of the id.** Eyes' `id #2` is gone.
  Attempt `n` is the runner's retry count plus one: Playwright's
  `testInfo.retry + 1`, Vitest's and Jest's retry index plus one. A retried case
  keeps one row, and its journals are keyed by case and attempt, so attempt 1
  is never overwritten and a reader names the attempt it wants.
- **The Playwright fixture takes its case from the case scope**
  (`testOf(testInfo)`), not `testInfo.testId`. RTL's `watchTest` takes the
  running case when no id is given.
- **Every path in the record is repository-relative.** An Eyes source location
  joins without `--root`.
- **`distill` reads the record.** It reads the record `variance covering`
  reads for the checkout, `testCoverageFile(root)`, unless `--execution` names
  another record. `--eyes` is removed. A retried case is read attempt by
  attempt, each named. An id that does not resolve is refused.

## One set of rules

Landing, layering, seeding, repinning, shard folding, `variance share` and
`carry` handle one file under one lock. Every fold carries every section by the
row key it is laid on. A fold that meets a section it does not know refuses, so
it never drops one silently.

The format version moves once, for a record that carries cases: a reader that
knows only coverage refuses it rather than misreading it, and a record without
cases keeps the version it had. A stray `.cases.bin` is not read: the next run,
or the next mainline publish, writes the new record. That is the same answer CI already gives for a missing record:
it runs the whole suite once.

The cost is stated, not assumed. A selection reader opens only the sections it
names, so the case sections cost it bytes on disk and nothing decoded. Their
size is measured on this repository and on the seven-MUI corpus.

## What would discharge it

Each item lands as its own pull request, green on its own, in this order:

1. **Cases in the record.**
   - The case sections and crossings into the record's blocks.
   - One landing under one lock, which closes both `FIXME`s.
   - Seeding, repinning, the mainline layer, shard folding, `share` and `carry`
     on one file.
   - `.cases.bin` removed, and the size measured.
2. **A record without coverage.** An uninstrumented run that keeps cases writes
   the record with its module sections absent, and selection narrows nothing on
   it.
3. **Case preconditions** (spec 0093) as sections of the record.
4. **Eyes in the record.**
   - Journals per case and attempt, written only on opt-in.
   - The Playwright fixture and `watchTest` on the case scope.
   - Repository-relative paths.
   - `distill` reading the record, with `--eyes` and `writeEyesArchive`'s path
     removed.
   - A fixture where a Playwright retry keeps both attempts and joins exactly.
